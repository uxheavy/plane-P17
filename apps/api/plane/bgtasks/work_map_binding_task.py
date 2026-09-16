# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from plane.db.models import WorkMap, WorkMapBinding, WorkMapBindingPlacement
from plane.utils.work_map_scene import persisted_scene_node_keys


WORK_MAP_BINDING_PLACEMENT_LEASE = timedelta(minutes=15)


@shared_task
def expire_stale_work_map_binding_placements():
    now = timezone.now()
    cutoff = now - WORK_MAP_BINDING_PLACEMENT_LEASE
    placement_ids = WorkMapBindingPlacement.objects.filter(
        acknowledged_at__isnull=True,
        created_at__lt=cutoff,
    ).values_list("id", flat=True)
    for placement_id in placement_ids.iterator():
        with transaction.atomic():
            placement_ref = (
                WorkMapBindingPlacement.objects.filter(
                    id=placement_id,
                    acknowledged_at__isnull=True,
                    created_at__lt=cutoff,
                )
                .values("work_map_id", "binding_id")
                .first()
            )
            if placement_ref is None:
                continue
            work_map = WorkMap.objects.select_for_update().get(pk=placement_ref["work_map_id"])
            binding = WorkMapBinding.all_objects.select_for_update().filter(id=placement_ref["binding_id"]).first()
            if binding is None:
                continue
            placement = (
                WorkMapBindingPlacement.objects.select_for_update()
                .filter(id=placement_id, acknowledged_at__isnull=True, created_at__lt=cutoff)
                .first()
            )
            if placement is None:
                continue
            node_keys = persisted_scene_node_keys(work_map.scene_binary)
            if node_keys is None:
                continue
            if binding.node_key in node_keys:
                placement.acknowledged_at = timezone.now()
                placement.save(update_fields=["acknowledged_at", "updated_at"])
                continue
            WorkMapBindingPlacement.objects.filter(id=placement.id).delete()
            if not WorkMapBindingPlacement.objects.filter(
                binding=binding,
                acknowledged_at__isnull=True,
            ).exists():
                WorkMapBinding.objects.filter(id=binding.id).delete()

    WorkMapBindingPlacement.objects.filter(
        acknowledged_at__lt=now - timedelta(days=settings.HARD_DELETE_AFTER_DAYS)
    ).delete(soft=False)


# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
