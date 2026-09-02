# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.api.views import WorkspaceAgentMembershipEndpoint

urlpatterns = [
    path(
        "workspaces/<str:slug>/agent-memberships/<str:agent_key>/",
        WorkspaceAgentMembershipEndpoint.as_view(http_method_names=["put"]),
        name="workspace-agent-membership",
    )
]
