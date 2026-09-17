# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

from rest_framework.permissions import SAFE_METHODS, BasePermission

from plane.db.models import Channel, Workspace, WorkspaceMember

from .base import ROLE


class ChannelPermission(BasePermission):
    """Authorize channel resources from their owning workspace membership."""

    def has_permission(self, request, view):
        if request.user.is_anonymous or not request.user.is_active:
            return False

        channel_id = view.kwargs.get("channel_id")
        if channel_id:
            workspace_id = Channel.objects.filter(id=channel_id).values_list("workspace_id", flat=True).first()
        else:
            workspace_id = Workspace.objects.filter(slug=view.kwargs.get("slug")).values_list("id", flat=True).first()

        if workspace_id is None:
            return False

        members = WorkspaceMember.objects.filter(
            workspace_id=workspace_id,
            member=request.user,
            is_active=True,
        )
        if request.method in SAFE_METHODS:
            return members.exists()
        return members.filter(role__in=(ROLE.ADMIN.value, ROLE.MEMBER.value)).exists()
