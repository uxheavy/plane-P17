# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid
from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from plane.app.views.work_map.scene import try_decode_work_map_scene, work_map_scene_assets
from plane.db.models import (
    DocumentVersionAsset,
    FileAsset,
    WorkMap,
    WorkMapDuplicateOperation,
    WorkMapPasteRebinding,
    WorkMapSceneAssetPlacement,
)
from plane.settings.storage import S3Storage


WORK_MAP_ASSET_COPY_LEASE = timedelta(minutes=15)
WORK_MAP_SCENE_ASSET_PLACEMENT_LEASE = timedelta(minutes=15)


def cleanup_stale_operations(model):
    now = timezone.now()
    stale_ids = (
        model.objects.filter(status=model.Status.COPYING)
        .filter(
            Q(lease_expires_at__lt=now)
            | Q(lease_expires_at__isnull=True, updated_at__lt=now - WORK_MAP_ASSET_COPY_LEASE)
        )
        .values_list("id", flat=True)
    )
    storage = S3Storage()

    for operation_id in stale_ids.iterator():
        cleanup_lease_id = uuid.uuid4()
        with transaction.atomic():
            operation = (
                model.objects.select_for_update()
                .filter(
                    id=operation_id,
                    status=model.Status.COPYING,
                )
                .first()
            )
            if operation is None or (
                operation.lease_expires_at is not None and operation.lease_expires_at >= timezone.now()
            ):
                continue
            operation.lease_id = cleanup_lease_id
            operation.lease_expires_at = timezone.now() + WORK_MAP_ASSET_COPY_LEASE
            operation.save(update_fields=["lease_id", "lease_expires_at", "updated_at"])
            destination_keys = operation.destination_keys

        if destination_keys and not storage.delete_files(destination_keys):
            continue
        model.objects.filter(id=operation_id, lease_id=cleanup_lease_id).update(
            status=model.Status.FAILED,
            lease_id=None,
            lease_expires_at=None,
            deleted_at=timezone.now(),
        )


def cleanup_stale_scene_asset_placements():
    now = timezone.now()
    cutoff = now - WORK_MAP_SCENE_ASSET_PLACEMENT_LEASE
    placement_ids = WorkMapSceneAssetPlacement.all_objects.filter(
        Q(deleted_at__isnull=True, created_at__lt=cutoff) | Q(deleted_at__lt=cutoff)
    ).values_list("id", flat=True)
    storage = S3Storage()

    for placement_id in placement_ids.iterator():
        deletion_marker = timezone.now()
        object_name = None
        with transaction.atomic():
            placement = WorkMapSceneAssetPlacement.all_objects.filter(
                id=placement_id,
                created_at__lt=cutoff,
            ).first()
            if placement is None:
                continue
            work_map = WorkMap.objects.select_for_update().get(pk=placement.work_map_id)
            asset = FileAsset.all_objects.select_for_update().filter(pk=placement.asset_id).first()
            placement = (
                WorkMapSceneAssetPlacement.all_objects.select_for_update()
                .filter(
                    id=placement_id,
                    created_at__lt=cutoff,
                )
                .first()
            )
            if placement is None:
                continue
            if asset is None:
                placement.delete(soft=False)
                continue
            scene = try_decode_work_map_scene(work_map.scene_binary)
            if scene is None:
                continue
            try:
                scene_asset_ids = set(work_map_scene_assets(scene).values())
            except ValueError:
                continue
            if asset.id in scene_asset_ids or DocumentVersionAsset.all_objects.filter(asset=asset).exists():
                if placement.deleted_at is not None and asset.deleted_at == placement.deleted_at:
                    asset.deleted_at = None
                    asset.is_deleted = False
                    asset.save(update_fields=["deleted_at", "is_deleted", "updated_at"])
                placement.delete(soft=False)
                continue
            object_name = asset.asset.name
            asset.deleted_at = deletion_marker
            asset.is_deleted = True
            asset.save(update_fields=["deleted_at", "is_deleted", "updated_at"])
            placement.deleted_at = deletion_marker
            placement.save(update_fields=["deleted_at", "updated_at"])

        with transaction.atomic():
            placement = WorkMapSceneAssetPlacement.all_objects.filter(
                id=placement_id,
                deleted_at=deletion_marker,
            ).first()
            if placement is None:
                continue
            work_map = WorkMap.objects.select_for_update().get(pk=placement.work_map_id)
            asset = (
                FileAsset.all_objects.select_for_update()
                .filter(
                    pk=placement.asset_id,
                    deleted_at=deletion_marker,
                )
                .first()
            )
            placement = (
                WorkMapSceneAssetPlacement.all_objects.select_for_update()
                .filter(
                    id=placement_id,
                    deleted_at=deletion_marker,
                )
                .first()
            )
            if placement is None:
                continue
            if asset is None:
                placement.delete(soft=False)
                continue
            scene = try_decode_work_map_scene(work_map.scene_binary)
            if scene is None:
                asset.deleted_at = None
                asset.is_deleted = False
                asset.save(update_fields=["deleted_at", "is_deleted", "updated_at"])
                placement.delete(soft=False)
                continue
            try:
                scene_asset_ids = set(work_map_scene_assets(scene).values())
            except ValueError:
                asset.deleted_at = None
                asset.is_deleted = False
                asset.save(update_fields=["deleted_at", "is_deleted", "updated_at"])
                placement.delete(soft=False)
                continue
            if asset.id in scene_asset_ids or DocumentVersionAsset.all_objects.filter(asset=asset).exists():
                asset.deleted_at = None
                asset.is_deleted = False
                asset.save(update_fields=["deleted_at", "is_deleted", "updated_at"])
                placement.delete(soft=False)
                continue

        if object_name and not storage.delete_files([object_name]):
            with transaction.atomic():
                placement = WorkMapSceneAssetPlacement.all_objects.filter(
                    id=placement_id,
                    deleted_at=deletion_marker,
                ).first()
                if placement is not None:
                    asset = (
                        FileAsset.all_objects.select_for_update()
                        .filter(
                            pk=placement.asset_id,
                            deleted_at=deletion_marker,
                        )
                        .first()
                    )
                    placement = (
                        WorkMapSceneAssetPlacement.all_objects.select_for_update()
                        .filter(
                            id=placement_id,
                            deleted_at=deletion_marker,
                        )
                        .first()
                    )
                    if asset is not None and placement is not None:
                        asset.deleted_at = None
                        asset.is_deleted = False
                        asset.save(update_fields=["deleted_at", "is_deleted", "updated_at"])
                        placement.deleted_at = None
                        placement.save(update_fields=["deleted_at", "updated_at"])
            continue

        with transaction.atomic():
            placement = WorkMapSceneAssetPlacement.all_objects.filter(
                id=placement_id,
                deleted_at=deletion_marker,
            ).first()
            if placement is None:
                continue
            asset = (
                FileAsset.all_objects.select_for_update()
                .filter(
                    pk=placement.asset_id,
                    deleted_at=deletion_marker,
                )
                .first()
            )
            placement = (
                WorkMapSceneAssetPlacement.all_objects.select_for_update()
                .filter(
                    id=placement_id,
                    deleted_at=deletion_marker,
                )
                .first()
            )
            if placement is None:
                continue
            if asset is None:
                placement.delete(soft=False)
                continue
            placement.delete(soft=False)
            asset.delete(soft=False)


@shared_task
def cleanup_stale_work_map_asset_copies():
    cleanup_stale_operations(WorkMapDuplicateOperation)
    cleanup_stale_operations(WorkMapPasteRebinding)
    cleanup_stale_scene_asset_placements()
