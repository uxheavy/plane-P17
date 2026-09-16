# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

from django.db import models

from .project import ProjectBaseModel


class WorkItemCreationIntent(ProjectBaseModel):
    """Idempotent identity and origin for one native work-item creation."""

    class OriginKind(models.TextChoices):
        CONVERSATION = "conversation", "Conversation"
        WORK_MAP = "work-map", "Work map"

    origin_kind = models.CharField(max_length=20, choices=OriginKind.choices)
    legacy_source_message = models.ForeignKey(
        "db.Message",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="legacy_work_item_intents",
    )
    channel = models.ForeignKey(
        "db.Channel",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="work_item_creation_intents",
    )
    thread_root = models.ForeignKey(
        "db.Message",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="thread_work_item_creation_intents",
    )
    work_map = models.ForeignKey(
        "db.WorkMap",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="work_item_creation_intents",
    )
    work_map_generation = models.PositiveBigIntegerField(null=True, blank=True)
    placement_id = models.UUIDField(null=True, blank=True)
    element_id = models.CharField(max_length=255, null=True, blank=True)
    creation_message = models.OneToOneField(
        "db.Message",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="created_work_item_intent",
    )
    origin_finalized_at = models.DateTimeField(null=True, blank=True)
    payload_hash = models.CharField(max_length=64)
    issue = models.OneToOneField(
        "db.Issue",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="work_item_creation_intent",
    )

    class Meta:
        db_table = "message_work_item_intents"
        indexes = [
            models.Index(fields=("origin_kind", "created_by"), name="work_item_creation_origin_idx"),
            models.Index(fields=("work_map", "element_id"), name="work_item_create_map_elem_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(
                        origin_kind="conversation",
                        channel__isnull=False,
                        work_map__isnull=True,
                        work_map_generation__isnull=True,
                        placement_id__isnull=True,
                        element_id__isnull=True,
                    )
                    | models.Q(
                        origin_kind="work-map",
                        channel__isnull=True,
                        thread_root__isnull=True,
                        work_map__isnull=False,
                        work_map_generation__isnull=False,
                        placement_id__isnull=False,
                        element_id__isnull=False,
                    )
                ),
                name="work_item_creation_origin_closed",
            ),
        ]
