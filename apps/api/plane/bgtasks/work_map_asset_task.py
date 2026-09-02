# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid
from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from plane.db.models import WorkMapDuplicateOperation, WorkMapPasteRebinding
from plane.settings.storage import S3Storage


WORK_MAP_ASSET_COPY_LEASE = timedelta(minutes=15)


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
        )


@shared_task
def cleanup_stale_work_map_asset_copies():
    cleanup_stale_operations(WorkMapDuplicateOperation)
    cleanup_stale_operations(WorkMapPasteRebinding)
