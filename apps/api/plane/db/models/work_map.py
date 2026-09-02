# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import models

from .base import BaseModel


class WorkMap(models.Model):
    document = models.OneToOneField(
        "db.Document",
        db_column="id",
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="work_map",
    )
    scene_binary = models.BinaryField(default=bytes)
    generation = models.PositiveBigIntegerField(default=0)

    class Meta:
        db_table = "work_maps"


class WorkMapBinding(BaseModel):
    class SourceKind(models.TextChoices):
        WORK_ITEM = "work-item", "Work item"
        CYCLE = "cycle", "Cycle"
        MODULE = "module", "Module"
        PROJECT_VIEW = "project-view", "Project view"
        PAGE = "page", "Page"
        INTAKE_ITEM = "intake-item", "Intake item"

    work_map = models.ForeignKey("db.WorkMap", on_delete=models.CASCADE, related_name="bindings")
    node_key = models.UUIDField(unique=True)
    source_kind = models.CharField(max_length=20, choices=SourceKind.choices)
    source_id = models.UUIDField()
    revision = models.PositiveBigIntegerField(default=1)

    class Meta:
        db_table = "work_map_bindings"
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["work_map", "source_kind", "source_id"],
                condition=models.Q(deleted_at__isnull=True),
                name="work_map_binding_unique_active_source",
            )
        ]
