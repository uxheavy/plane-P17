# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

import uuid

from django.db import models

from .base import BaseModel


class Channel(BaseModel):
    workspace = models.ForeignKey(
        "db.Workspace",
        on_delete=models.CASCADE,
        related_name="channels",
    )
    name = models.CharField(max_length=255)

    class Meta:
        db_table = "channels"
        ordering = ("name", "id")


class Message(BaseModel):
    channel = models.ForeignKey(
        Channel,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        related_name="replies",
        null=True,
        blank=True,
    )
    content = models.TextField()
    client_id = models.UUIDField(default=uuid.uuid4)

    class Meta:
        db_table = "channel_messages"
        ordering = ("created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("channel", "created_by", "client_id"),
                condition=models.Q(deleted_at__isnull=True),
                name="channel_message_client_id_unique",
            ),
        ]
        indexes = [
            models.Index(
                fields=("channel", "created_at", "id"),
                name="channel_message_order_idx",
            ),
            models.Index(
                fields=("channel", "parent", "created_at"),
                name="channel_message_parent_idx",
            ),
        ]
