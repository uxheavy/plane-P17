# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import base64
import json
import uuid

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.permissions.work_map import can_read_work_map_source
from plane.app.serializers import WorkMapSceneSerializer
from plane.app.serializers.asset import WORK_MAP_SCENE_ASSET_MIME_TYPES
from plane.db.models import (
    Document,
    FileAsset,
    WorkMap,
    WorkMapBinding,
    WorkMapBindingPlacement,
    WorkMapSceneAssetPlacement,
)

from ..base import BaseAPIView
from .base import visible_work_maps
from .binding import protected_binding_keys, validate_protected_binding_carriers


LEGACY_SCENE_UPGRADE_ERROR = "Work map scene requires upgrade"


class WorkMapSceneUpgradeRequired(Exception):
    pass


class WorkMapSceneOpaque(ValueError):
    """The bytes do not use the lifecycle scene representation."""


def decode_work_map_scene(scene_binary):
    if not scene_binary:
        return {"elements": [], "files": {}}

    try:
        scene = json.loads(bytes(scene_binary).decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise WorkMapSceneOpaque("Scene is not valid Work Map JSON")
    if (
        not isinstance(scene, dict)
        or not isinstance(scene.get("elements"), list)
        or not isinstance(scene.get("files"), dict)
    ):
        raise WorkMapSceneOpaque("Scene is not a Work Map document")
    return scene


def try_decode_work_map_scene(scene_binary, *, decoder=None):
    """Decode structured scene data without changing the opaque scene contract."""
    decoder = decode_work_map_scene if decoder is None else decoder
    try:
        return decoder(scene_binary)
    except WorkMapSceneOpaque:
        return None


def work_map_has_semantic_state(work_map, document_id):
    return (
        work_map.bindings.filter(deleted_at__isnull=True).exists()
        or FileAsset.objects.filter(
            document_id=document_id,
            entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
            is_uploaded=True,
            is_deleted=False,
            deleted_at__isnull=True,
        ).exists()
    )


def work_map_scene_assets(scene):
    assets = {}
    for file_id, metadata in scene["files"].items():
        if not isinstance(file_id, str) or not file_id or not isinstance(metadata, dict):
            raise ValueError("Scene file metadata is invalid")
        if set(metadata) != {"assetId", "mimeType", "created"}:
            raise ValueError("Scene file metadata contains unsupported fields")
        try:
            asset_id = uuid.UUID(str(metadata["assetId"]))
        except (TypeError, ValueError):
            raise ValueError("Scene file asset identifier is invalid")
        if metadata["mimeType"] not in WORK_MAP_SCENE_ASSET_MIME_TYPES:
            raise ValueError("Scene file MIME type is unsupported")
        if isinstance(metadata["created"], bool) or not isinstance(metadata["created"], int) or metadata["created"] < 0:
            raise ValueError("Scene file creation time is invalid")
        assets[file_id] = asset_id

    for element in scene["elements"]:
        if not isinstance(element, dict):
            raise ValueError("Scene element is invalid")
        if element.get("type") == "image" and element.get("fileId") not in scene["files"]:
            raise ValueError("Image element file is unavailable")
    return assets


def validate_work_map_scene_assets(scene, document_id, *, lock=False):
    scene_assets = work_map_scene_assets(scene)
    asset_query = FileAsset.objects
    if lock:
        asset_query = asset_query.select_for_update()
    assets = {
        asset.id: asset
        for asset in asset_query.filter(
            id__in=set(scene_assets.values()),
            document_id=document_id,
            workspace_id=F("document__workspace_id"),
            entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
            is_uploaded=True,
            is_deleted=False,
            deleted_at__isnull=True,
        )
    }
    if set(assets) != set(scene_assets.values()):
        raise ValueError("Scene file asset is unavailable")
    for file_id, asset_id in scene_assets.items():
        if assets[asset_id].attributes.get("type") != scene["files"][file_id]["mimeType"]:
            raise ValueError("Scene file MIME type does not match its asset")
    return assets


class WorkMapSceneEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, work_map_id):
        document = visible_work_maps(user=request.user, slug=slug, project_id=project_id).filter(id=work_map_id).first()
        if document is None:
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(
            {
                "generation": document.work_map.generation,
                "scene_binary": base64.b64encode(bytes(document.work_map.scene_binary)).decode("ascii"),
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, work_map_id):
        serializer = WorkMapSceneSerializer(data=request.data)
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
            work_map = WorkMap.objects.select_for_update().get(document=document)
            candidate_scene_binary = serializer.validated_data["scene_binary"]
            if bytes(candidate_scene_binary) == bytes(work_map.scene_binary):
                return Response({"generation": work_map.generation}, status=status.HTTP_200_OK)
            if document.is_locked or document.archived_at is not None:
                return Response({"error": "Work map is not editable"}, status=status.HTTP_409_CONFLICT)
            if serializer.validated_data["generation"] != work_map.generation:
                return Response(
                    {"error": "Work map generation is stale", "generation": work_map.generation},
                    status=status.HTTP_409_CONFLICT,
                )
            scene_asset_ids = set()
            try:
                current_scene = try_decode_work_map_scene(work_map.scene_binary)
                scene = try_decode_work_map_scene(candidate_scene_binary)
                if scene is None:
                    if current_scene is not None:
                        return Response({"error": LEGACY_SCENE_UPGRADE_ERROR}, status=status.HTTP_409_CONFLICT)
                    work_map.scene_binary = candidate_scene_binary
                    work_map.generation += 1
                    work_map.save(update_fields=["scene_binary", "generation"])
                    document.updated_by = request.user
                    document.save(update_fields=["updated_by", "updated_at"])
                    return Response({"generation": work_map.generation}, status=status.HTTP_200_OK)
                if current_scene is None and work_map_has_semantic_state(work_map, document.id):
                    return Response({"error": LEGACY_SCENE_UPGRADE_ERROR}, status=status.HTTP_409_CONFLICT)
                assets = validate_work_map_scene_assets(scene, document.id, lock=True)
                scene_asset_ids = set(assets)
                carrier_keys = protected_binding_keys(scene)
                referenced_bindings = {
                    binding.node_key: binding
                    for binding in WorkMapBinding.all_objects.select_for_update().filter(node_key__in=carrier_keys)
                }
                if set(referenced_bindings) != carrier_keys or any(
                    binding.work_map_id != work_map.pk for binding in referenced_bindings.values()
                ):
                    raise ValueError("Plane carrier binding is unavailable")
                if not all(
                    can_read_work_map_source(
                        user=request.user,
                        workspace_id=document.workspace_id,
                        source_kind=binding.source_kind,
                        source_id=binding.source_id,
                    )
                    for binding in referenced_bindings.values()
                ):
                    raise ValueError("Plane carrier binding source is unavailable")

                active_bindings = {
                    binding.node_key: binding
                    for binding in work_map.bindings.select_for_update().filter(deleted_at__isnull=True)
                }
                pending_binding_ids = set(
                    WorkMapBindingPlacement.objects.select_for_update()
                    .filter(
                        work_map=work_map,
                        acknowledged_at__isnull=True,
                    )
                    .values_list("binding_id", flat=True)
                )
                retained_bindings = list(referenced_bindings.values()) + [
                    binding
                    for node_key, binding in active_bindings.items()
                    if node_key not in carrier_keys and binding.id in pending_binding_ids
                ]
                retained_sources = [(binding.source_kind, binding.source_id) for binding in retained_bindings]
                if len(retained_sources) != len(set(retained_sources)):
                    raise ValueError("Plane source has conflicting protected binding keys")
                validate_protected_binding_carriers(
                    scene,
                    referenced_bindings,
                    require_every_binding=False,
                )
            except ValueError:
                return Response({"error": "Work map scene is invalid"}, status=status.HTTP_409_CONFLICT)

            changed_at = timezone.now()
            WorkMapBinding.objects.filter(
                work_map=work_map,
                deleted_at__isnull=True,
            ).exclude(node_key__in=carrier_keys).exclude(id__in=pending_binding_ids).update(deleted_at=changed_at)
            WorkMapBinding.all_objects.filter(
                work_map=work_map,
                node_key__in=carrier_keys,
            ).update(deleted_at=None, updated_by=request.user, updated_at=changed_at)
            WorkMapBindingPlacement.objects.filter(
                work_map=work_map,
                binding__node_key__in=carrier_keys,
                acknowledged_at__isnull=True,
            ).update(acknowledged_at=changed_at, updated_by=request.user, updated_at=changed_at)
            WorkMapSceneAssetPlacement.all_objects.filter(
                work_map=work_map,
                asset_id__in=scene_asset_ids,
            ).delete()
            work_map.scene_binary = candidate_scene_binary
            work_map.generation += 1
            work_map.save(update_fields=["scene_binary", "generation"])
            document.updated_by = request.user
            document.save(update_fields=["updated_by", "updated_at"])
        return Response({"generation": work_map.generation}, status=status.HTTP_200_OK)
