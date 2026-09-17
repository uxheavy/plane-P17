# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import (
    WorkMapBindingEndpoint,
    WorkMapBindingHydrationEndpoint,
    WorkMapBindingOpenEndpoint,
    WorkMapDuplicateEndpoint,
    WorkMapFavoriteViewSet,
    WorkMapPasteRebindingEndpoint,
    WorkMapRealtimeEndpoint,
    WorkMapSceneEndpoint,
    WorkMapSourceDiscoveryEndpoint,
    WorkMapVersionEndpoint,
    WorkMapVersionRestoreEndpoint,
    WorkMapViewSet,
)


urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/",
        WorkMapViewSet.as_view({"get": "list", "post": "create"}),
        name="project-work-maps",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/",
        WorkMapViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
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
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/sources/",
        WorkMapSourceDiscoveryEndpoint.as_view(),
        name="project-work-map-sources",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/bindings/hydrate/",
        WorkMapBindingHydrationEndpoint.as_view(),
        name="project-work-map-binding-hydration",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/bindings/open/",
        WorkMapBindingOpenEndpoint.as_view(),
        name="project-work-map-binding-open",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/binding-placements/<uuid:placement_id>/",
        WorkMapBindingEndpoint.as_view(),
        name="project-work-map-binding-placement",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/duplicate/",
        WorkMapDuplicateEndpoint.as_view(),
        name="project-work-map-duplicate",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/paste-rebindings/",
        WorkMapPasteRebindingEndpoint.as_view(),
        name="project-work-map-paste-rebindings",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/favorite-work-maps/<uuid:work_map_id>/",
        WorkMapFavoriteViewSet.as_view({"post": "create", "delete": "destroy"}),
        name="user-favorite-work-maps",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/versions/",
        WorkMapVersionEndpoint.as_view(),
        name="project-work-map-versions",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/versions/<uuid:version_id>/restore/",
        WorkMapVersionRestoreEndpoint.as_view(),
        name="project-work-map-version-restore",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/archive/",
        WorkMapViewSet.as_view({"post": "archive", "delete": "unarchive"}),
        name="project-work-map-archive-unarchive",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-maps/<uuid:work_map_id>/lock/",
        WorkMapViewSet.as_view({"post": "lock", "delete": "unlock"}),
        name="project-work-map-lock-unlock",
    ),
]
