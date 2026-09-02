# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.conf import settings
from django.db import models
from django.utils import timezone

from .base import BaseModel


class Document(BaseModel):
    class Kind(models.TextChoices):
        PAGE = "page", "Page"
        WORK_MAP = "work-map", "Work map"

    PRIVATE_ACCESS = 1
    PUBLIC_ACCESS = 0
    DEFAULT_SORT_ORDER = 65535

    kind = models.CharField(max_length=8, choices=Kind.choices)
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="documents")
    owned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="documents")
    name = models.TextField(blank=True)
    access = models.PositiveSmallIntegerField(
        choices=((PUBLIC_ACCESS, "Public"), (PRIVATE_ACCESS, "Private")), default=PUBLIC_ACCESS
    )
    archived_at = models.DateField(null=True)
    is_locked = models.BooleanField(default=False)
    sort_order = models.FloatField(default=DEFAULT_SORT_ORDER)
    projects = models.ManyToManyField("db.Project", related_name="documents", through="db.DocumentProject")

    class Meta:
        db_table = "documents"
        ordering = ("-created_at",)


class DocumentProject(BaseModel):
    document = models.ForeignKey("db.Document", on_delete=models.CASCADE, related_name="document_projects")
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="project_documents")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="document_projects")

    class Meta:
        db_table = "document_projects"
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(
                fields=["document", "project"],
                condition=models.Q(deleted_at__isnull=True),
                name="document_project_unique_active_link",
            )
        ]


class DocumentVersion(BaseModel):
    document = models.ForeignKey("db.Document", on_delete=models.CASCADE, related_name="document_versions")
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="document_versions")
    last_saved_at = models.DateTimeField(default=timezone.now)
    owned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="document_versions")

    class Meta:
        db_table = "document_versions"
        ordering = ("-created_at",)
