# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.permissions.work_map import can_read_work_map_source
from plane.app.serializers import WorkMapVersionRestoreSerializer, WorkMapVersionSerializer
from plane.db.models import (
    Document,
    DocumentVersion,
    DocumentVersionAsset,
    WorkMap,
    WorkMapBinding,
    WorkMapVersion,
)

from ..base import BaseAPIView
from .base import visible_work_maps
from .binding import validate_protected_binding_carriers
from .scene import (
    LEGACY_SCENE_UPGRADE_ERROR,
    decode_work_map_scene,
    try_decode_work_map_scene,
    validate_work_map_scene_assets,
    work_map_has_semantic_state,
)

MAX_WORK_MAP_VERSIONS = 20


def prune_work_map_versions(document):
    retained_ids = list(
        DocumentVersion.objects.filter(document=document, work_map__isnull=False)
        .order_by("-created_at", "-id")
        .values_list("id", flat=True)[:MAX_WORK_MAP_VERSIONS]
    )
    DocumentVersion.all_objects.filter(document=document, work_map__isnull=False).exclude(id__in=retained_ids).delete()


class WorkMapVersionEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, work_map_id):
        if not visible_work_maps(user=request.user, slug=slug, project_id=project_id).filter(id=work_map_id).exists():
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
        versions = (
            WorkMapVersion.objects.filter(document_version__document_id=work_map_id)
            .select_related("document_version")
            .order_by("-document_version__created_at")
        )
        return Response(WorkMapVersionSerializer(versions, many=True).data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, work_map_id):
        with transaction.atomic():
            visible_id = (
                visible_work_maps(user=request.user, slug=slug, project_id=project_id)
                .filter(id=work_map_id)
                .values_list("id", flat=True)
                .first()
            )
            document = Document.objects.select_for_update().filter(id=visible_id).first()
            if document is None:
                return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
            work_map = WorkMap.objects.select_for_update().get(document=document)
            try:
                scene = try_decode_work_map_scene(work_map.scene_binary, decoder=decode_work_map_scene)
            except ValueError:
                return Response({"error": "Work map version cannot be created"}, status=status.HTTP_409_CONFLICT)
            if scene is None:
                if work_map_has_semantic_state(work_map, document.id):
                    return Response({"error": LEGACY_SCENE_UPGRADE_ERROR}, status=status.HTTP_409_CONFLICT)
                assets = {}
            else:
                try:
                    assets = validate_work_map_scene_assets(scene, document.id, lock=True)
                except ValueError:
                    return Response({"error": "Work map version cannot be created"}, status=status.HTTP_409_CONFLICT)
            binding_snapshot = [
                {
                    "node_key": str(binding.node_key),
                    "source_kind": binding.source_kind,
                    "source_id": str(binding.source_id),
                    "revision": binding.revision,
                }
                for binding in work_map.bindings.filter(deleted_at__isnull=True).order_by("created_at")
            ]
            if scene is not None:
                try:
                    validate_protected_binding_carriers(
                        scene,
                        {uuid.UUID(binding["node_key"]): binding for binding in binding_snapshot},
                    )
                except ValueError:
                    return Response({"error": "Work map version cannot be created"}, status=status.HTTP_409_CONFLICT)
            document_version = DocumentVersion.objects.create(
                document=document,
                workspace=document.workspace,
                owned_by=request.user,
                created_by=request.user,
            )
            version = WorkMapVersion.objects.create(
                document_version=document_version,
                scene_binary=work_map.scene_binary,
                binding_snapshot=binding_snapshot,
                generation=work_map.generation,
            )
            DocumentVersionAsset.objects.bulk_create(
                [DocumentVersionAsset(document_version=document_version, asset=asset) for asset in assets.values()],
                ignore_conflicts=True,
            )
            prune_work_map_versions(document)

        return Response(WorkMapVersionSerializer(version).data, status=status.HTTP_201_CREATED)


class WorkMapVersionRestoreEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, work_map_id, version_id):
        serializer = WorkMapVersionRestoreSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            visible_id = (
                visible_work_maps(user=request.user, slug=slug, project_id=project_id)
                .filter(id=work_map_id)
                .values_list("id", flat=True)
                .first()
            )
            document = Document.objects.select_for_update().filter(id=visible_id).first()
            if document is None:
                return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
            if document.is_locked or document.archived_at is not None:
                return Response({"error": "Work map is not editable"}, status=status.HTTP_409_CONFLICT)
            work_map = WorkMap.objects.select_for_update().get(document=document)
            if serializer.validated_data["generation"] != work_map.generation:
                return Response(
                    {"error": "Work map generation is stale", "generation": work_map.generation},
                    status=status.HTTP_409_CONFLICT,
                )
            version = WorkMapVersion.objects.filter(
                document_version_id=version_id,
                document_version__document=document,
            ).first()
            if version is None:
                return Response({"error": "Work map version not found"}, status=status.HTTP_404_NOT_FOUND)

            try:
                version_scene = try_decode_work_map_scene(version.scene_binary, decoder=decode_work_map_scene)
                current_scene = try_decode_work_map_scene(work_map.scene_binary, decoder=decode_work_map_scene)
            except ValueError:
                return Response({"error": "Work map version cannot be restored"}, status=status.HTTP_409_CONFLICT)
            if version_scene is None:
                if (
                    version.binding_snapshot
                    or current_scene is not None
                    or work_map_has_semantic_state(work_map, document.id)
                ):
                    return Response({"error": LEGACY_SCENE_UPGRADE_ERROR}, status=status.HTTP_409_CONFLICT)
                version_assets = {}
            else:
                try:
                    version_assets = validate_work_map_scene_assets(version_scene, document.id, lock=True)
                    validate_protected_binding_carriers(
                        version_scene,
                        {uuid.UUID(binding["node_key"]): binding for binding in version.binding_snapshot},
                    )
                except ValueError:
                    return Response({"error": "Work map version cannot be restored"}, status=status.HTTP_409_CONFLICT)
            retained_asset_ids = set(version.document_version.asset_links.values_list("asset_id", flat=True))
            if retained_asset_ids != set(version_assets):
                return Response(
                    {"error": "Work map version asset snapshot is incomplete"},
                    status=status.HTTP_409_CONFLICT,
                )

            if not all(
                can_read_work_map_source(
                    user=request.user,
                    workspace_id=document.workspace_id,
                    source_kind=binding["source_kind"],
                    source_id=binding["source_id"],
                )
                for binding in version.binding_snapshot
            ):
                return Response(
                    {"error": "Work map version source is unavailable"},
                    status=status.HTTP_409_CONFLICT,
                )

            snapshot_keys = [uuid.UUID(binding["node_key"]) for binding in version.binding_snapshot]
            stored_bindings = {
                binding.node_key: binding
                for binding in WorkMapBinding.all_objects.select_for_update().filter(node_key__in=snapshot_keys)
            }
            if any(binding.work_map_id != work_map.pk for binding in stored_bindings.values()):
                return Response(
                    {"error": "Work map version binding is unavailable"},
                    status=status.HTTP_409_CONFLICT,
                )

            WorkMapBinding.objects.filter(work_map=work_map).update(deleted_at=timezone.now())
            for snapshot in version.binding_snapshot:
                node_key = uuid.UUID(snapshot["node_key"])
                binding = stored_bindings.get(node_key)
                if binding is None:
                    WorkMapBinding.objects.create(
                        work_map=work_map,
                        node_key=node_key,
                        source_kind=snapshot["source_kind"],
                        source_id=snapshot["source_id"],
                        revision=snapshot["revision"],
                        created_by=request.user,
                    )
                    continue
                binding.source_kind = snapshot["source_kind"]
                binding.source_id = snapshot["source_id"]
                binding.revision = snapshot["revision"]
                binding.deleted_at = None
                binding.updated_by = request.user
                binding.save(
                    update_fields=[
                        "source_kind",
                        "source_id",
                        "revision",
                        "deleted_at",
                        "updated_by",
                        "updated_at",
                    ]
                )
            work_map.scene_binary = version.scene_binary
            work_map.generation += 1
            work_map.collaboration_epoch += 1
            work_map.save(update_fields=["scene_binary", "generation", "collaboration_epoch"])
            document.updated_by = request.user
            document.save(update_fields=["updated_by", "updated_at"])

        return Response({"generation": work_map.generation}, status=status.HTTP_200_OK)
