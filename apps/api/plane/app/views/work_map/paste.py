# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import copy
import hashlib
import json
import uuid
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.permissions.document import visible_document_in_any_project
from plane.app.permissions.project import can_write_projects
from plane.app.permissions.work_map import can_read_work_map_source
from plane.app.serializers import WorkMapPasteRebindingSerializer
from plane.db.models import (
    Document,
    FileAsset,
    WorkMap,
    WorkMapBinding,
    WorkMapBindingPlacement,
    WorkMapPasteRebinding,
)
from plane.settings.storage import S3Storage
from plane.utils.path_validator import sanitize_filename

from ..base import BaseAPIView
from .base import visible_work_maps
from .scene import decode_work_map_scene


PASTE_LEASE_DURATION = timedelta(minutes=15)


class WorkMapPasteSourceUnavailable(Exception):
    pass


class WorkMapPasteAssetCopyError(Exception):
    pass


def paste_request_hash(data):
    normalized = {
        "generation": data["generation"],
        "node_keys": sorted(str(node_key) for node_key in data["node_keys"]),
        "files": sorted(
            ({"file_id": item["file_id"], "asset_id": str(item["asset_id"])} for item in data["files"]),
            key=lambda item: item["file_id"],
        ),
    }
    return hashlib.sha256(json.dumps(normalized, separators=(",", ":"), sort_keys=True).encode()).hexdigest()


def paste_response(operation, files):
    return {
        "generation": operation.generation,
        "node_keys": operation.node_key_map,
        "files": {item["file_id"]: operation.asset_id_map[str(item["asset_id"])] for item in files},
    }


def mark_failed_after_cleanup(operation, lease_id, storage):
    with transaction.atomic():
        operation = (
            WorkMapPasteRebinding.all_objects.select_for_update()
            .filter(
                id=operation.id,
                status=WorkMapPasteRebinding.Status.COPYING,
                lease_id=lease_id,
            )
            .first()
        )
        if operation is None:
            return
        operation.lease_expires_at = timezone.now() + PASTE_LEASE_DURATION
        operation.save(update_fields=["lease_expires_at", "updated_at"])
        destination_keys = list(operation.destination_keys)

    cleaned = not destination_keys or storage.delete_files(destination_keys)
    if cleaned:
        WorkMapPasteRebinding.objects.filter(id=operation.id, lease_id=lease_id).update(
            status=WorkMapPasteRebinding.Status.FAILED,
            lease_id=None,
            lease_expires_at=None,
        )


def renew_copy_lease(operation_id, lease_id):
    if (
        WorkMapPasteRebinding.objects.filter(
            id=operation_id,
            status=WorkMapPasteRebinding.Status.COPYING,
            lease_id=lease_id,
        ).update(lease_expires_at=timezone.now() + PASTE_LEASE_DURATION)
        != 1
    ):
        raise WorkMapPasteSourceUnavailable


def authorized_paste_sources(*, user, workspace_id, node_keys, files, lock):
    binding_query = WorkMapBinding.objects
    asset_query = FileAsset.objects
    if lock:
        binding_query = binding_query.select_for_update(of=("self",))
        asset_query = asset_query.select_for_update(of=("self",))

    bindings = {
        binding.node_key: binding
        for binding in binding_query.filter(node_key__in=node_keys).select_related("work_map__document")
    }
    if set(bindings) != set(node_keys):
        raise WorkMapPasteSourceUnavailable
    for binding in bindings.values():
        source_document = binding.work_map.document
        if source_document.workspace_id != workspace_id or not visible_document_in_any_project(
            user=user,
            workspace_id=workspace_id,
            document_id=source_document.id,
        ):
            raise WorkMapPasteSourceUnavailable
        if not can_read_work_map_source(
            user=user,
            workspace_id=workspace_id,
            source_kind=binding.source_kind,
            source_id=binding.source_id,
        ):
            raise WorkMapPasteSourceUnavailable

    requested_asset_ids = [item["asset_id"] for item in files]
    assets = {
        asset.id: asset
        for asset in asset_query.filter(
            id__in=requested_asset_ids,
            workspace_id=workspace_id,
            entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
            is_uploaded=True,
            is_deleted=False,
            deleted_at__isnull=True,
        ).select_related("document__work_map")
    }
    if set(assets) != set(requested_asset_ids):
        raise WorkMapPasteSourceUnavailable
    scenes = {}
    for item in files:
        asset = assets[item["asset_id"]]
        source_document = asset.document
        if (
            source_document is None
            or source_document.kind != Document.Kind.WORK_MAP
            or not visible_document_in_any_project(
                user=user,
                workspace_id=workspace_id,
                document_id=source_document.id,
            )
        ):
            raise WorkMapPasteSourceUnavailable
        try:
            scene = scenes.setdefault(
                source_document.id,
                decode_work_map_scene(source_document.work_map.scene_binary),
            )
        except ValueError as error:
            raise WorkMapPasteSourceUnavailable from error
        metadata = scene["files"].get(item["file_id"])
        if not isinstance(metadata, dict) or metadata.get("assetId") != str(asset.id):
            raise WorkMapPasteSourceUnavailable
    return bindings, assets


class WorkMapPasteRebindingEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, work_map_id):
        serializer = WorkMapPasteRebindingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        request_hash = paste_request_hash(data)
        lease_id = uuid.uuid4()
        storage = S3Storage(request=request)
        operation = None

        try:
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
                work_map = WorkMap.objects.select_for_update().get(pk=document.id)
                operation = (
                    WorkMapPasteRebinding.all_objects.select_for_update()
                    .filter(
                        work_map=work_map,
                        created_by=request.user,
                        idempotency_key=data["idempotency_key"],
                    )
                    .first()
                )
                if operation is not None:
                    if operation.request_hash != request_hash:
                        return Response(
                            {"error": "Idempotency key was already used"},
                            status=status.HTTP_409_CONFLICT,
                        )
                    if operation.status == WorkMapPasteRebinding.Status.COMMITTED:
                        return Response(paste_response(operation, data["files"]), status=status.HTTP_200_OK)
                    if operation.status == WorkMapPasteRebinding.Status.FAILED:
                        return Response(
                            {"error": "Paste rebinding failed"},
                            status=status.HTTP_409_CONFLICT,
                        )
                    if operation.lease_expires_at is not None and operation.lease_expires_at > timezone.now():
                        return Response(
                            {"error": "Paste rebinding is in progress"},
                            status=status.HTTP_409_CONFLICT,
                        )
                if document.is_locked or document.archived_at is not None:
                    return Response({"error": "Work map is not editable"}, status=status.HTTP_409_CONFLICT)
                if data["generation"] != work_map.generation:
                    return Response(
                        {"error": "Work map generation is stale", "generation": work_map.generation},
                        status=status.HTTP_409_CONFLICT,
                    )
                if operation is not None:
                    operation.lease_id = lease_id
                    operation.lease_expires_at = timezone.now() + PASTE_LEASE_DURATION
                    operation.save(update_fields=["lease_id", "lease_expires_at", "updated_at"])
                else:
                    bindings, assets = authorized_paste_sources(
                        user=request.user,
                        workspace_id=document.workspace_id,
                        node_keys=data["node_keys"],
                        files=data["files"],
                        lock=True,
                    )
                    target_bindings = {
                        (binding.source_kind, binding.source_id): binding
                        for binding in work_map.bindings.select_for_update().filter(deleted_at__isnull=True)
                    }
                    source_key_targets = {}
                    source_targets = {}
                    for source_key, binding in bindings.items():
                        source = (binding.source_kind, binding.source_id)
                        target_binding = target_bindings.get(source)
                        target_key = (
                            target_binding.node_key
                            if target_binding is not None
                            else source_targets.setdefault(source, uuid.uuid4())
                        )
                        source_key_targets[str(source_key)] = str(target_key)

                    asset_id_map = {}
                    destination_keys = []
                    for asset in sorted(assets.values(), key=lambda item: str(item.id)):
                        if asset.document_id == document.id:
                            asset_id_map[str(asset.id)] = str(asset.id)
                            continue
                        target_asset_id = uuid.uuid4()
                        name = sanitize_filename(asset.attributes.get("name")) or "unnamed"
                        destination_key = f"{document.workspace_id}/{target_asset_id.hex}-{name}"
                        asset_id_map[str(asset.id)] = str(target_asset_id)
                        destination_keys.append(destination_key)
                    operation = WorkMapPasteRebinding.objects.create(
                        work_map=work_map,
                        idempotency_key=data["idempotency_key"],
                        request_hash=request_hash,
                        generation=work_map.generation,
                        node_key_map=source_key_targets,
                        asset_id_map=asset_id_map,
                        destination_keys=destination_keys,
                        lease_id=lease_id,
                        lease_expires_at=timezone.now() + PASTE_LEASE_DURATION,
                        created_by=request.user,
                    )

            _, source_assets = authorized_paste_sources(
                user=request.user,
                workspace_id=document.workspace_id,
                node_keys=data["node_keys"],
                files=data["files"],
                lock=False,
            )
            destination_by_asset = dict(
                zip(
                    [
                        asset
                        for asset in sorted(source_assets.values(), key=lambda item: str(item.id))
                        if asset.document_id != document.id
                    ],
                    operation.destination_keys,
                    strict=True,
                )
            )
            for source_asset, destination_key in destination_by_asset.items():
                renew_copy_lease(operation.id, lease_id)
                if storage.copy_object(source_asset.asset.name, destination_key) is None:
                    raise WorkMapPasteAssetCopyError
                renew_copy_lease(operation.id, lease_id)

            with transaction.atomic():
                operation = WorkMapPasteRebinding.objects.select_for_update().get(id=operation.id)
                if operation.lease_id != lease_id or operation.status != WorkMapPasteRebinding.Status.COPYING:
                    raise WorkMapPasteSourceUnavailable
                visible_id = (
                    visible_work_maps(user=request.user, slug=slug, project_id=project_id)
                    .filter(id=document.id)
                    .values_list("id", flat=True)
                    .first()
                )
                if visible_id is None or not can_write_projects(
                    user=request.user,
                    workspace_id=document.workspace_id,
                    project_ids=[project_id],
                ):
                    raise WorkMapPasteSourceUnavailable
                document = Document.objects.select_for_update().filter(id=visible_id).first()
                if document is None or document.is_locked or document.archived_at is not None:
                    raise WorkMapPasteSourceUnavailable
                work_map = WorkMap.objects.select_for_update().get(pk=document.id)
                if work_map.generation != operation.generation:
                    raise WorkMapPasteSourceUnavailable
                bindings, source_assets = authorized_paste_sources(
                    user=request.user,
                    workspace_id=document.workspace_id,
                    node_keys=data["node_keys"],
                    files=data["files"],
                    lock=True,
                )

                target_assets = []
                destination_keys = iter(operation.destination_keys)
                for source_asset in sorted(source_assets.values(), key=lambda item: str(item.id)):
                    target_asset_id = uuid.UUID(operation.asset_id_map[str(source_asset.id)])
                    if target_asset_id == source_asset.id:
                        continue
                    target_assets.append(
                        FileAsset(
                            id=target_asset_id,
                            attributes=copy.deepcopy(source_asset.attributes),
                            asset=next(destination_keys),
                            size=source_asset.size,
                            workspace=document.workspace,
                            document=document,
                            entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
                            storage_metadata=copy.deepcopy(source_asset.storage_metadata),
                            is_uploaded=True,
                            created_by=request.user,
                            updated_by=request.user,
                        )
                    )
                FileAsset.objects.bulk_create(target_assets)

                for source_key, source_binding in bindings.items():
                    target_key = uuid.UUID(operation.node_key_map[str(source_key)])
                    if source_binding.work_map_id == work_map.pk and source_binding.node_key == target_key:
                        continue
                    target_binding, _ = WorkMapBinding.objects.get_or_create(
                        work_map=work_map,
                        source_kind=source_binding.source_kind,
                        source_id=source_binding.source_id,
                        defaults={
                            "node_key": target_key,
                            "revision": source_binding.revision,
                            "created_by": request.user,
                        },
                    )
                    if target_binding.node_key != target_key:
                        raise WorkMapPasteSourceUnavailable
                    WorkMapBindingPlacement.objects.get_or_create(
                        work_map=work_map,
                        binding=target_binding,
                        created_by=request.user,
                        placement_id=uuid.uuid5(operation.id, str(source_key)),
                    )

                operation.status = WorkMapPasteRebinding.Status.COMMITTED
                operation.committed_at = timezone.now()
                operation.lease_id = None
                operation.lease_expires_at = None
                operation.save(
                    update_fields=[
                        "status",
                        "committed_at",
                        "lease_id",
                        "lease_expires_at",
                        "updated_at",
                    ]
                )
        except (IntegrityError, WorkMapPasteSourceUnavailable):
            if operation is not None:
                mark_failed_after_cleanup(operation, lease_id, storage)
            return Response({"error": "Paste source changed"}, status=status.HTTP_409_CONFLICT)
        except WorkMapPasteAssetCopyError:
            if operation is not None:
                mark_failed_after_cleanup(operation, lease_id, storage)
            return Response({"error": "Paste asset copy failed"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except Exception:
            if operation is not None:
                mark_failed_after_cleanup(operation, lease_id, storage)
            raise

        return Response(paste_response(operation, data["files"]), status=status.HTTP_201_CREATED)
