from django.urls import path

from plane.api.views import WorkItemClaimEndpoint


urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/claim/",
        WorkItemClaimEndpoint.as_view(http_method_names=["post"]),
        name="work-item-claim",
    ),
]
