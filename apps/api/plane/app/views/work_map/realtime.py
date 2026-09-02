# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.db.models import ProjectMember, WorkspaceMember

from ..base import BaseAPIView
from .base import visible_work_maps


class WorkMapRealtimeEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, work_map_id):
        document = visible_work_maps(user=request.user, slug=slug, project_id=project_id).filter(id=work_map_id).first()
        if document is None:
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)

        project_member = ProjectMember.objects.filter(
            workspace__slug=slug,
            project_id=project_id,
            member=request.user,
            is_active=True,
        )
        editable = project_member.filter(role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value]).exists() or (
            project_member.exists()
            and WorkspaceMember.objects.filter(
                workspace__slug=slug,
                member=request.user,
                role=ROLE.ADMIN.value,
                is_active=True,
            ).exists()
        )

        return Response(
            {
                "document_type": "work_map",
                "workspace_slug": slug,
                "project_id": project_id,
                "work_map_id": document.id,
                "sender_id": request.user.id,
                "generation": document.work_map.generation,
                "collaboration_epoch": document.work_map.collaboration_epoch,
                "readable": True,
                "editable": editable and not document.is_locked and document.archived_at is None,
                "is_locked": document.is_locked,
                "archived_at": document.archived_at,
            },
            status=status.HTTP_200_OK,
        )
