# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

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
from plane.app.permissions.project import can_write_projects
from plane.app.permissions.work_map import can_read_work_map_source
from plane.db.models import (
    Document,
    DocumentProject,
    FileAsset,
    WorkMap,
    WorkMapBinding,
    WorkMapDuplicateOperation,
)
from plane.settings.storage import S3Storage
from plane.utils.path_validator import sanitize_filename

from ..base import BaseAPIView
from .base import serialize_work_map, visible_work_maps
from .binding import WORK_MAP_NODE_LINK_PREFIX, validate_protected_binding_carriers
from .scene import (
    LEGACY_SCENE_UPGRADE_ERROR,
    WorkMapSceneUpgradeRequired,
    decode_work_map_scene,
    try_decode_work_map_scene,
    validate_work_map_scene_assets,
    work_map_has_semantic_state,
)


class WorkMapAssetCopyError(Exception):
    pass


class WorkMapSourceChanged(Exception):
    pass


DUPLICATE_LEASE_DURATION = timedelta(minutes=15)


def binding_snapshot(work_map, *, lock=False):
    bindings = work_map.bindings.filter(deleted_at__isnull=True).order_by("created_at")
    if lock:
        bindings = bindings.select_for_update()
    return {
        binding.node_key: (
            binding.source_kind,
            binding.source_id,
            binding.revision,
        )
        for binding in bindings
    }


def project_snapshot(document):
    return tuple(
        document.document_projects.filter(deleted_at__isnull=True)
        .order_by("project_id")
        .values_list("project_id", "workspace_id")
    )


def asset_snapshot(assets):
    return {
        asset_id: (
            copy.deepcopy(asset.attributes),
            asset.asset.name,
            asset.size,
            copy.deepcopy(asset.storage_metadata),
        )
        for asset_id, asset in assets.items()
    }


def duplicate_snapshot(document, bindings, assets):
    return {
        "document": {
            "workspace_id": str(document.workspace_id),
            "name": document.name,
            "access": document.access,
            "sort_order": document.sort_order,
            "archived_at": document.archived_at.isoformat() if document.archived_at else None,
            "is_locked": document.is_locked,
        },
        "projects": [[str(project_id), str(workspace_id)] for project_id, workspace_id in project_snapshot(document)],
        "bindings": {
            str(node_key): [source_kind, str(source_id), revision]
            for node_key, (source_kind, source_id, revision) in bindings.items()
        },
        "assets": {
            str(asset_id): [attributes, object_name, size, storage_metadata]
            for asset_id, (attributes, object_name, size, storage_metadata) in asset_snapshot(assets).items()
        },
    }


def duplicate_scene(scene_binary, bindings, key_map=None):
    if not scene_binary:
        if bindings:
            raise ValueError("Scene has protected bindings but no content")
        return None, {}

    scene = try_decode_work_map_scene(scene_binary, decoder=decode_work_map_scene)
    if scene is None:
        if bindings:
            raise WorkMapSceneUpgradeRequired
        return None, {}
    validate_protected_binding_carriers(scene, bindings)

    key_map = {} if key_map is None else key_map
    for element in scene["elements"]:
        custom_data = element.get("customData")
        if isinstance(custom_data, dict):
            custom_data.pop("enabledOrigin", None)
        node_key_value = custom_data.get("nodeKey") if isinstance(custom_data, dict) else None
        if node_key_value is None:
            continue
        source_key = uuid.UUID(str(node_key_value))
        target_key = uuid.UUID(str(key_map.setdefault(str(source_key), str(uuid.uuid4()))))
        custom_data["nodeKey"] = str(target_key)
        element["link"] = f"{WORK_MAP_NODE_LINK_PREFIX}{target_key}"

    return scene, key_map


def validate_duplicate_sources(*, user, workspace_id, bindings):
    if not all(
        can_read_work_map_source(
            user=user,
            workspace_id=workspace_id,
            source_kind=source_kind,
            source_id=source_id,
        )
        for source_kind, source_id, _revision in bindings.values()
    ):
        raise WorkMapSourceChanged


def copy_scene_assets(
    scene,
    source_assets,
    *,
    target_document_id,
    workspace_id,
    storage,
    target_asset_ids,
    destination_names,
    operation_id,
    lease_id,
):
    if scene is None:
        return []

    target_assets = []
    asset_map = {uuid.UUID(source_id): uuid.UUID(target_id) for source_id, target_id in target_asset_ids.items()}
    for source_asset, destination_name in zip(
        sorted(source_assets.values(), key=lambda asset: str(asset.id)),
        destination_names,
        strict=True,
    ):
        renew_copy_lease(operation_id, lease_id)
        target_asset_id = asset_map[source_asset.id]
        if storage.copy_object(source_asset.asset.name, destination_name) is None:
            raise WorkMapAssetCopyError
        renew_copy_lease(operation_id, lease_id)
        target_assets.append(
            FileAsset(
                id=target_asset_id,
                attributes=copy.deepcopy(source_asset.attributes),
                asset=destination_name,
                size=source_asset.size,
                workspace_id=workspace_id,
                document_id=target_document_id,
                entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
                storage_metadata=copy.deepcopy(source_asset.storage_metadata),
                is_uploaded=True,
            )
        )
        asset_map[source_asset.id] = target_asset_id

    for metadata in scene["files"].values():
        metadata["assetId"] = str(asset_map[uuid.UUID(metadata["assetId"])])
    return target_assets


def mark_failed_after_cleanup(operation, lease_id, storage):
    with transaction.atomic():
        operation = (
            WorkMapDuplicateOperation.all_objects.select_for_update()
            .filter(
                id=operation.id,
                status=WorkMapDuplicateOperation.Status.COPYING,
                lease_id=lease_id,
            )
            .first()
        )
        if operation is None:
            return
        operation.lease_expires_at = timezone.now() + DUPLICATE_LEASE_DURATION
        operation.save(update_fields=["lease_expires_at", "updated_at"])
        destination_keys = list(operation.destination_keys)

    cleaned = not destination_keys or storage.delete_files(destination_keys)
    if cleaned:
        WorkMapDuplicateOperation.objects.filter(id=operation.id, lease_id=lease_id).update(
            status=WorkMapDuplicateOperation.Status.FAILED,
            lease_id=None,
            lease_expires_at=None,
            deleted_at=timezone.now(),
        )


def renew_copy_lease(operation_id, lease_id):
    if (
        WorkMapDuplicateOperation.objects.filter(
            id=operation_id,
            status=WorkMapDuplicateOperation.Status.COPYING,
            lease_id=lease_id,
        ).update(lease_expires_at=timezone.now() + DUPLICATE_LEASE_DURATION)
        != 1
    ):
        raise WorkMapSourceChanged


class WorkMapDuplicateEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, work_map_id):
        if request.data:
            return Response(
                {"error": "Duplicate does not accept client scene data"}, status=status.HTTP_400_BAD_REQUEST
            )
        try:
            idempotency_key = uuid.UUID(request.headers.get("Idempotency-Key", ""))
        except ValueError:
            return Response(
                {"error": "A valid Idempotency-Key header is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
                source = Document.objects.select_for_update().filter(id=visible_id).first()
                if source is None:
                    return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
                source_work_map = WorkMap.objects.select_for_update().get(document=source)
                operation = (
                    WorkMapDuplicateOperation.all_objects.select_for_update()
                    .filter(
                        source_work_map=source_work_map,
                        created_by=request.user,
                        idempotency_key=idempotency_key,
                    )
                    .first()
                )
                if operation is not None and operation.status == WorkMapDuplicateOperation.Status.COMMITTED:
                    duplicate = (
                        Document.objects.filter(id=operation.target_document_id).select_related("work_map").first()
                    )
                    if duplicate is None:
                        raise WorkMapSourceChanged
                    duplicate.is_favorite = False
                    return Response(serialize_work_map(duplicate), status=status.HTTP_200_OK)
                if operation is not None and operation.status == WorkMapDuplicateOperation.Status.FAILED:
                    return Response(
                        {"error": "Work map duplication failed"},
                        status=status.HTTP_409_CONFLICT,
                    )
                if (
                    operation is not None
                    and operation.lease_expires_at is not None
                    and operation.lease_expires_at > timezone.now()
                ):
                    return Response(
                        {"error": "Work map duplication is in progress"},
                        status=status.HTTP_409_CONFLICT,
                    )
                bindings = binding_snapshot(source_work_map, lock=True)
                source_scene_binary = bytes(source_work_map.scene_binary)
                source_scene = try_decode_work_map_scene(source_scene_binary, decoder=decode_work_map_scene)
                if source_scene is None:
                    if work_map_has_semantic_state(source_work_map, source.id):
                        raise WorkMapSceneUpgradeRequired
                    source_assets = {}
                else:
                    validate_protected_binding_carriers(source_scene, bindings)
                    source_assets = validate_work_map_scene_assets(source_scene, source.id, lock=True)
                validate_duplicate_sources(
                    user=request.user,
                    workspace_id=source.workspace_id,
                    bindings=bindings,
                )
                source_snapshot = duplicate_snapshot(source, bindings, source_assets)
                linked_project_ids = [project_id for project_id, _workspace_id in project_snapshot(source)]
                if not can_write_projects(
                    user=request.user,
                    workspace_id=source.workspace_id,
                    project_ids=linked_project_ids,
                ):
                    raise WorkMapSourceChanged
                source_scene_hash = hashlib.sha256(source_scene_binary).hexdigest()

                if operation is not None:
                    if (
                        operation.source_generation != source_work_map.generation
                        or operation.source_scene_hash != source_scene_hash
                        or operation.source_snapshot != source_snapshot
                    ):
                        raise WorkMapSourceChanged
                    operation.lease_id = lease_id
                    operation.lease_expires_at = timezone.now() + DUPLICATE_LEASE_DURATION
                    operation.save(update_fields=["lease_id", "lease_expires_at", "updated_at"])
                else:
                    target_document_id = uuid.uuid4()
                    node_key_map = {str(node_key): str(uuid.uuid4()) for node_key in bindings}
                    target_asset_ids = {str(asset_id): str(uuid.uuid4()) for asset_id in source_assets}
                    destination_keys = []
                    for source_asset in sorted(source_assets.values(), key=lambda asset: str(asset.id)):
                        target_asset_id = uuid.UUID(target_asset_ids[str(source_asset.id)])
                        name = sanitize_filename(source_asset.attributes.get("name")) or "unnamed"
                        destination_keys.append(f"{source.workspace_id}/{target_asset_id.hex}-{name}")
                    operation = WorkMapDuplicateOperation.objects.create(
                        source_work_map=source_work_map,
                        idempotency_key=idempotency_key,
                        source_generation=source_work_map.generation,
                        source_scene_hash=source_scene_hash,
                        source_snapshot=source_snapshot,
                        target_document_id=target_document_id,
                        node_key_map=node_key_map,
                        target_asset_ids=target_asset_ids,
                        destination_keys=destination_keys,
                        lease_id=lease_id,
                        lease_expires_at=timezone.now() + DUPLICATE_LEASE_DURATION,
                        created_by=request.user,
                    )

            scene, key_map = duplicate_scene(source_scene_binary, bindings, operation.node_key_map)
            target_assets = copy_scene_assets(
                scene,
                source_assets,
                target_document_id=operation.target_document_id,
                workspace_id=source.workspace_id,
                storage=storage,
                target_asset_ids=operation.target_asset_ids,
                destination_names=operation.destination_keys,
                operation_id=operation.id,
                lease_id=lease_id,
            )
            target_scene_binary = (
                source_scene_binary
                if scene is None
                else json.dumps(scene, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            )

            with transaction.atomic():
                visible_id = (
                    visible_work_maps(user=request.user, slug=slug, project_id=project_id)
                    .filter(id=work_map_id)
                    .values_list("id", flat=True)
                    .first()
                )
                current = Document.objects.select_for_update().filter(id=visible_id).first()
                if current is None:
                    raise WorkMapSourceChanged
                current_work_map = WorkMap.objects.select_for_update().get(document=current)
                current_scene = try_decode_work_map_scene(
                    current_work_map.scene_binary,
                    decoder=decode_work_map_scene,
                )
                if current_scene is None:
                    if work_map_has_semantic_state(current_work_map, current.id):
                        raise WorkMapSceneUpgradeRequired
                    current_assets = {}
                else:
                    current_assets = validate_work_map_scene_assets(current_scene, current.id, lock=True)
                current_bindings = binding_snapshot(current_work_map, lock=True)
                current_project_ids = [project_id for project_id, _workspace_id in project_snapshot(current)]
                if not can_write_projects(
                    user=request.user,
                    workspace_id=current.workspace_id,
                    project_ids=current_project_ids,
                ):
                    raise WorkMapSourceChanged
                validate_duplicate_sources(
                    user=request.user,
                    workspace_id=current.workspace_id,
                    bindings=current_bindings,
                )
                operation = WorkMapDuplicateOperation.objects.select_for_update().get(id=operation.id)
                if (
                    operation.lease_id != lease_id
                    or operation.status != WorkMapDuplicateOperation.Status.COPYING
                    or current_work_map.generation != operation.source_generation
                    or hashlib.sha256(bytes(current_work_map.scene_binary)).hexdigest() != operation.source_scene_hash
                    or duplicate_snapshot(current, current_bindings, current_assets) != operation.source_snapshot
                ):
                    raise WorkMapSourceChanged

                duplicate = Document.objects.create(
                    id=operation.target_document_id,
                    kind=Document.Kind.WORK_MAP,
                    workspace=current.workspace,
                    owned_by=request.user,
                    created_by=request.user,
                    updated_by=request.user,
                    name=f"{current.name} (Copy)",
                    access=current.access,
                    sort_order=current.sort_order,
                )
                for asset in target_assets:
                    asset.created_by = request.user
                    asset.updated_by = request.user
                FileAsset.objects.bulk_create(target_assets)
                duplicate_work_map = WorkMap.objects.create(document=duplicate, scene_binary=target_scene_binary)
                DocumentProject.objects.bulk_create(
                    [
                        DocumentProject(
                            document=duplicate,
                            project_id=linked_project_id,
                            workspace_id=linked_workspace_id,
                            created_by=request.user,
                            updated_by=request.user,
                        )
                        for linked_project_id, linked_workspace_id in project_snapshot(current)
                    ]
                )
                WorkMapBinding.objects.bulk_create(
                    [
                        WorkMapBinding(
                            work_map=duplicate_work_map,
                            node_key=uuid.UUID(key_map[str(source_key)]),
                            source_kind=source_kind,
                            source_id=source_id,
                            revision=revision,
                            created_by=request.user,
                            updated_by=request.user,
                        )
                        for source_key, (source_kind, source_id, revision) in current_bindings.items()
                    ]
                )
                operation.status = WorkMapDuplicateOperation.Status.COMMITTED
                operation.committed_at = timezone.now()
                operation.deleted_at = timezone.now()
                operation.lease_id = None
                operation.lease_expires_at = None
                operation.save(
                    update_fields=[
                        "status",
                        "committed_at",
                        "deleted_at",
                        "lease_id",
                        "lease_expires_at",
                        "updated_at",
                    ]
                )
        except WorkMapSceneUpgradeRequired:
            if operation is not None:
                mark_failed_after_cleanup(operation, lease_id, storage)
            return Response({"error": LEGACY_SCENE_UPGRADE_ERROR}, status=status.HTTP_409_CONFLICT)
        except ValueError:
            if operation is not None:
                mark_failed_after_cleanup(operation, lease_id, storage)
            return Response({"error": "Work map cannot be duplicated"}, status=status.HTTP_409_CONFLICT)
        except WorkMapSourceChanged:
            if operation is not None:
                mark_failed_after_cleanup(operation, lease_id, storage)
            return Response({"error": "Work map changed during duplication"}, status=status.HTTP_409_CONFLICT)
        except WorkMapAssetCopyError:
            if operation is not None:
                mark_failed_after_cleanup(operation, lease_id, storage)
            return Response({"error": "Work map asset copy failed"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except IntegrityError:
            if operation is not None:
                mark_failed_after_cleanup(operation, lease_id, storage)
            return Response({"error": "Target binding key unavailable"}, status=status.HTTP_409_CONFLICT)
        except Exception:
            if operation is not None:
                mark_failed_after_cleanup(operation, lease_id, storage)
            raise

        duplicate.is_favorite = False
        return Response(serialize_work_map(duplicate), status=status.HTTP_201_CREATED)
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
