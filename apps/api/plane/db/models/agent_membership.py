# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import models

from .base import BaseModel


class WorkspaceAgentMembership(BaseModel):
    """Lifecycle ownership only; native membership rows remain authoritative."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="agent_memberships")
    agent_key = models.CharField(max_length=255)
    user = models.OneToOneField("db.User", on_delete=models.PROTECT, related_name="agent_membership")

    class Meta:
        db_table = "workspace_agent_memberships"
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "agent_key"],
                condition=models.Q(deleted_at__isnull=True),
                name="workspace_agent_membership_unique_key",
            )
        ]


class WorkspaceAgentMembershipReceipt(BaseModel):
    membership = models.ForeignKey(WorkspaceAgentMembership, on_delete=models.CASCADE, related_name="receipts")
    idempotency_key = models.CharField(max_length=255)
    request_hash = models.CharField(max_length=64)
    response = models.JSONField(default=dict)

    class Meta:
        db_table = "workspace_agent_membership_receipts"
        constraints = [
            models.UniqueConstraint(
                fields=["membership", "idempotency_key"],
                condition=models.Q(deleted_at__isnull=True),
                name="workspace_agent_membership_receipt_unique_key",
            )
        ]
