# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from plane.db.models import Cycle, IntakeIssue, Issue, IssueView, Module, Page, ProjectMember, ProjectPage


def can_read_work_map_source(*, user, workspace_id, source_kind, source_id):
    if source_kind == "work-item":
        source = Issue.objects.filter(id=source_id, workspace_id=workspace_id).only("project_id").first()
        feature = None
    elif source_kind == "cycle":
        source = Cycle.objects.filter(id=source_id, workspace_id=workspace_id).only("project_id").first()
        feature = "cycle_view"
    elif source_kind == "module":
        source = Module.objects.filter(id=source_id, workspace_id=workspace_id).only("project_id").first()
        feature = "module_view"
    elif source_kind == "project-view":
        source = (
            IssueView.objects.filter(id=source_id, workspace_id=workspace_id, project_id__isnull=False)
            .only("project_id")
            .first()
        )
        feature = "issue_views_view"
    elif source_kind == "intake-item":
        source = IntakeIssue.objects.filter(id=source_id, workspace_id=workspace_id).only("project_id").first()
        feature = "intake_view"
    elif source_kind == "page":
        page = Page.objects.filter(id=source_id, workspace_id=workspace_id).only("id", "access", "owned_by_id").first()
        if page is None or (page.access == Page.PRIVATE_ACCESS and page.owned_by_id != user.id):
            return False
        return ProjectPage.objects.filter(
            page_id=page.id,
            deleted_at__isnull=True,
            project__page_view=True,
            project__project_projectmember__member=user,
            project__project_projectmember__is_active=True,
        ).exists()
    else:
        return False

    if source is None:
        return False
    filters = {
        "project_id": source.project_id,
        "workspace_id": workspace_id,
        "member": user,
        "is_active": True,
    }
    if feature is not None:
        filters[f"project__{feature}"] = True
    return ProjectMember.objects.filter(**filters).exists()
