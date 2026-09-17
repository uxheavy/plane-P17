# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path

from plane.app.views import (
    AgentProfileEndpoint,
    AgentProfileModelEndpoint,
    AgentProfileSkillApprovalEndpoint,
    AgentProfileSkillEndpoint,
    AgentProfileSkillPendingEndpoint,
    AgentProfileSkillRejectionEndpoint,
)


urlpatterns = [
    path(
        "workspaces/<str:slug>/agents/<uuid:user_id>/profile/skills/pending/<str:pending_id>/approve/",
        AgentProfileSkillApprovalEndpoint.as_view(http_method_names=["post"]),
        name="workspace-agent-profile-skill-approve",
    ),
    path(
        "workspaces/<str:slug>/agents/<uuid:user_id>/profile/skills/pending/<str:pending_id>/reject/",
        AgentProfileSkillRejectionEndpoint.as_view(http_method_names=["post"]),
        name="workspace-agent-profile-skill-reject",
    ),
    path(
        "workspaces/<str:slug>/agents/<uuid:user_id>/profile/skills/pending/",
        AgentProfileSkillPendingEndpoint.as_view(http_method_names=["get"]),
        name="workspace-agent-profile-skill-pending",
    ),
    path(
        "workspaces/<str:slug>/agents/<uuid:user_id>/profile/skills/<str:owner_id>/<path:skill_id>/",
        AgentProfileSkillEndpoint.as_view(http_method_names=["get", "patch"]),
        name="workspace-agent-profile-skill",
    ),
    path(
        "workspaces/<str:slug>/agents/<uuid:user_id>/profile/model/",
        AgentProfileModelEndpoint.as_view(http_method_names=["get", "patch"]),
        name="workspace-agent-profile-model",
    ),
    path(
        "workspaces/<str:slug>/agents/<uuid:user_id>/profile/",
        AgentProfileEndpoint.as_view(http_method_names=["get", "patch"]),
        name="workspace-agent-profile",
    ),
]
