from django.urls import path

from plane.api.views import WorkspaceAgentMembershipEndpoint

urlpatterns = [
    path(
        "workspaces/<str:slug>/agent-memberships/<str:agent_key>/",
        WorkspaceAgentMembershipEndpoint.as_view(http_method_names=["put"]),
        name="workspace-agent-membership",
    )
]
