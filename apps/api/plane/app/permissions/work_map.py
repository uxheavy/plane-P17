# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db.models import Q

from plane.app.permissions import ROLE
from plane.db.models import Cycle, Document, DocumentProject, IntakeIssue, Issue, IssueView, Module, Page
from plane.utils.module_counts import with_module_issue_counts


def _readable_project_sources(queryset, *, user, workspace_id, feature=None, guest_owner_field=None):
    filters = {
        "workspace_id": workspace_id,
        "project__archived_at__isnull": True,
        "project__project_projectmember__member": user,
        "project__project_projectmember__is_active": True,
    }
    if feature is not None:
        filters[f"project__{feature}"] = True
    queryset = queryset.filter(**filters)
    if guest_owner_field is not None:
        queryset = queryset.filter(
            Q(project__project_projectmember__role__gt=ROLE.GUEST.value)
            | Q(project__guest_view_all_features=True)
            | Q(**{guest_owner_field: user})
        )
    return queryset.select_related("project").distinct()


def readable_work_map_sources(
    *, user, workspace_id, source_kind, source_ids=None, query="", project_id=None, limit=None
):
    if source_kind == "work-item":
        queryset = _readable_project_sources(
            Issue.issue_objects.all(),
            user=user,
            workspace_id=workspace_id,
            guest_owner_field="created_by",
        ).select_related("state")
        name_field = "name"
    elif source_kind == "cycle":
        queryset = _readable_project_sources(
            Cycle.objects.filter(archived_at__isnull=True),
            user=user,
            workspace_id=workspace_id,
            feature="cycle_view",
        )
        name_field = "name"
    elif source_kind == "module":
        queryset = _readable_project_sources(
            Module.objects.filter(archived_at__isnull=True),
            user=user,
            workspace_id=workspace_id,
            feature="module_view",
        )
        queryset = with_module_issue_counts(queryset)
        name_field = "name"
    elif source_kind == "project-view":
        queryset = _readable_project_sources(
            IssueView.objects.filter(project_id__isnull=False, archived_at__isnull=True).filter(
                Q(owned_by=user) | Q(access=1)
            ),
            user=user,
            workspace_id=workspace_id,
            feature="issue_views_view",
            guest_owner_field="owned_by",
        )
        name_field = "name"
    elif source_kind == "intake-item":
        queryset = _readable_project_sources(
            IntakeIssue.objects.filter(issue__deleted_at__isnull=True, intake__deleted_at__isnull=True),
            user=user,
            workspace_id=workspace_id,
            feature="intake_view",
            guest_owner_field="created_by",
        ).select_related("issue", "issue__state")
        name_field = "issue__name"
    elif source_kind == "page":
        links = DocumentProject.objects.filter(
            workspace_id=workspace_id,
            deleted_at__isnull=True,
            document__kind=Document.Kind.PAGE,
            document__deleted_at__isnull=True,
            project__archived_at__isnull=True,
            project__page_view=True,
            project__project_projectmember__member=user,
            project__project_projectmember__is_active=True,
        ).filter(Q(document__owned_by=user) | Q(document__access=Page.PUBLIC_ACCESS))
        if project_id is not None:
            links = links.filter(project_id=project_id)
        if source_ids is not None:
            links = links.filter(document_id__in=source_ids)
        if query:
            links = links.filter(document__name__icontains=query)
        links = (
            links.select_related("document", "document__page", "project")
            .order_by("document__name", "document_id", "project_id")
            .distinct()
        )
        if limit is not None:
            links = links[:limit]
        seen = set()
        results = []
        for link in links:
            if link.document_id not in seen:
                seen.add(link.document_id)
                results.append((link.document.page, link.project))
        return results
    else:
        return []

    if source_ids is not None:
        queryset = queryset.filter(id__in=source_ids)
    if project_id is not None:
        queryset = queryset.filter(project_id=project_id)
    if query:
        queryset = queryset.filter(**{f"{name_field}__icontains": query})
    queryset = queryset.order_by(name_field, "id")
    if limit is not None:
        queryset = queryset[:limit]
    return [(source, source.project) for source in queryset]


def can_read_work_map_source(*, user, workspace_id, source_kind, source_id):
    return bool(
        readable_work_map_sources(
            user=user,
            workspace_id=workspace_id,
            source_kind=source_kind,
            source_ids=[source_id],
            limit=1,
        )
    )
