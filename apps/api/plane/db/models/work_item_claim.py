# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

from django.conf import settings
from django.db import models
from django.db.models import Q

from .issue import Issue
from .project import ProjectBaseModel


class WorkItemClaim(ProjectBaseModel):
    """The durable active claim for a native work-item execution."""

    request_id = models.UUIDField(unique=True)
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="work_item_claims")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="work_item_claims",
    )
    released_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "work_item_claims"
        constraints = [
            models.UniqueConstraint(
                fields=["issue"],
                condition=Q(released_at__isnull=True, deleted_at__isnull=True),
                name="work_item_claim_one_active_per_issue",
            )
        ]
