# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db.models import Q

from plane.db.models import Document


def visible_documents(*, user, slug, project_id):
    return (
        Document.objects.filter(
            workspace__slug=slug,
            document_projects__workspace__slug=slug,
            document_projects__project_id=project_id,
            document_projects__deleted_at__isnull=True,
            document_projects__project__workspace__slug=slug,
            document_projects__project__archived_at__isnull=True,
            document_projects__project__project_projectmember__member=user,
            document_projects__project__project_projectmember__is_active=True,
        )
        .filter(Q(owned_by=user) | Q(access=Document.PUBLIC_ACCESS))
        .distinct()
    )


def visible_document_in_any_project(*, user, workspace_id, document_id):
    return (
        Document.objects.filter(
            id=document_id,
            workspace_id=workspace_id,
            document_projects__workspace_id=workspace_id,
            document_projects__deleted_at__isnull=True,
            document_projects__project__workspace_id=workspace_id,
            document_projects__project__archived_at__isnull=True,
            document_projects__project__project_projectmember__member=user,
            document_projects__project__project_projectmember__is_active=True,
        )
        .filter(Q(owned_by=user) | Q(access=Document.PUBLIC_ACCESS))
        .exists()
    )


def visible_page_in_any_project(*, user, workspace_id, document_id):
    return (
        Document.objects.filter(
            id=document_id,
            kind=Document.Kind.PAGE,
            workspace_id=workspace_id,
            document_projects__workspace_id=workspace_id,
            document_projects__deleted_at__isnull=True,
            document_projects__project__workspace_id=workspace_id,
            document_projects__project__archived_at__isnull=True,
            document_projects__project__page_view=True,
            document_projects__project__project_projectmember__member=user,
            document_projects__project__project_projectmember__is_active=True,
        )
        .filter(Q(owned_by=user) | Q(access=Document.PUBLIC_ACCESS))
        .exists()
    )
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
