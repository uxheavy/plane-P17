# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import WorkMapBindingEndpoint, WorkMapRealtimeEndpoint, WorkMapSceneEndpoint, WorkMapViewSet


urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/",
        WorkMapViewSet.as_view({"get": "list", "post": "create"}),
        name="project-work-maps",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/",
        WorkMapViewSet.as_view({"get": "retrieve", "patch": "partial_update"}),
        name="project-work-map",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/scene/",
        WorkMapSceneEndpoint.as_view(),
        name="project-work-map-scene",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/realtime/",
        WorkMapRealtimeEndpoint.as_view(),
        name="project-work-map-realtime",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/bindings/",
        WorkMapBindingEndpoint.as_view(),
        name="project-work-map-bindings",
    ),
]
