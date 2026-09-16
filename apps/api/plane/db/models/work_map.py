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
    collaboration_epoch = models.PositiveBigIntegerField(default=0)

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


class WorkMapBindingPlacement(BaseModel):
    work_map = models.ForeignKey("db.WorkMap", on_delete=models.CASCADE, related_name="binding_placements")
    binding = models.ForeignKey("db.WorkMapBinding", on_delete=models.CASCADE, related_name="placements")
    placement_id = models.UUIDField()
    acknowledged_at = models.DateTimeField(null=True)

    class Meta:
        db_table = "work_map_binding_placements"
        constraints = [
            models.UniqueConstraint(
                fields=["work_map", "created_by", "placement_id"],
                name="work_map_binding_placement_unique_request",
            )
        ]


class WorkMapSceneAssetPlacement(BaseModel):
    """Own a finalized scene asset until a durable scene or cleanup does."""

    work_map = models.ForeignKey("db.WorkMap", on_delete=models.CASCADE, related_name="scene_asset_placements")
    asset = models.OneToOneField(
        "db.FileAsset",
        on_delete=models.CASCADE,
        related_name="work_map_scene_placement",
    )

    class Meta:
        db_table = "work_map_scene_asset_placements"


class WorkMapPasteRebinding(BaseModel):
    class Status(models.TextChoices):
        COPYING = "copying", "Copying"
        COMMITTED = "committed", "Committed"
        FAILED = "failed", "Failed"

    work_map = models.ForeignKey("db.WorkMap", on_delete=models.CASCADE, related_name="paste_rebindings")
    idempotency_key = models.UUIDField()
    request_hash = models.CharField(max_length=64)
    generation = models.PositiveBigIntegerField()
    node_key_map = models.JSONField(default=dict)
    asset_id_map = models.JSONField(default=dict)
    destination_keys = models.JSONField(default=list)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.COPYING)
    lease_id = models.UUIDField(null=True)
    lease_expires_at = models.DateTimeField(null=True)
    committed_at = models.DateTimeField(null=True)

    class Meta:
        db_table = "work_map_paste_rebindings"
        constraints = [
            models.UniqueConstraint(
                fields=["work_map", "created_by", "idempotency_key"],
                name="work_map_paste_rebinding_unique_request",
            )
        ]


class WorkMapDuplicateOperation(BaseModel):
    class Status(models.TextChoices):
        COPYING = "copying", "Copying"
        COMMITTED = "committed", "Committed"
        FAILED = "failed", "Failed"

    source_work_map = models.ForeignKey(
        "db.WorkMap",
        null=True,
        on_delete=models.SET_NULL,
        related_name="duplicate_operations",
    )
    idempotency_key = models.UUIDField()
    source_generation = models.PositiveBigIntegerField()
    source_scene_hash = models.CharField(max_length=64)
    source_snapshot = models.JSONField(default=dict)
    target_document_id = models.UUIDField()
    node_key_map = models.JSONField(default=dict)
    target_asset_ids = models.JSONField(default=dict)
    destination_keys = models.JSONField(default=list)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.COPYING)
    lease_id = models.UUIDField(null=True)
    lease_expires_at = models.DateTimeField(null=True)
    committed_at = models.DateTimeField(null=True)

    class Meta:
        db_table = "work_map_duplicate_operations"
        constraints = [
            models.UniqueConstraint(
                fields=["source_work_map", "created_by", "idempotency_key"],
                name="work_map_duplicate_operation_unique_request",
            )
        ]


class WorkMapVersion(models.Model):
    document_version = models.OneToOneField(
        "db.DocumentVersion",
        db_column="id",
        on_delete=models.CASCADE,
        primary_key=True,
        related_name="work_map",
    )
    scene_binary = models.BinaryField(default=bytes)
    binding_snapshot = models.JSONField(default=list)
    generation = models.PositiveBigIntegerField()

    class Meta:
        db_table = "work_map_versions"
