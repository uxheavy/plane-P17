# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.permissions.work_map import readable_work_map_sources
from plane.app.serializers import (
    WorkMapBindingHydrationSerializer,
    WorkMapBindingOpenSerializer,
    WorkMapSourceDiscoverySerializer,
)
from plane.db.models import WorkMapBinding

from .base import BaseAPIView
from .work_map.base import visible_work_maps


def _source_projection(source_kind, source, project):
    projection = {
        "source_kind": source_kind,
        "source_id": source.id,
        "project_id": project.id,
        "project_name": project.name,
        "name": source.issue.name if source_kind == "intake-item" else source.name,
    }
    if source_kind == "work-item":
        projection.update(
            sequence_id=source.sequence_id,
            priority=source.priority,
            start_date=source.start_date,
            target_date=source.target_date,
            type_id=source.type_id,
            state=_state_projection(source.state),
        )
    elif source_kind == "cycle":
        projection.update(start_date=source.start_date, end_date=source.end_date)
    elif source_kind == "module":
        projection.update(status=source.status, start_date=source.start_date, target_date=source.target_date)
    elif source_kind == "intake-item":
        projection.update(
            sequence_id=source.issue.sequence_id,
            priority=source.issue.priority,
            start_date=source.issue.start_date,
            target_date=source.issue.target_date,
            type_id=source.issue.type_id,
            state=_state_projection(source.issue.state),
            intake_status=source.status,
        )
    return projection


def _state_projection(state):
    if state is None:
        return None
    return {"id": state.id, "name": state.name, "color": state.color, "group": state.group}


def _unavailable(node_key):
    return {"node_key": node_key, "available": False}


def _visible_work_map(request, slug, project_id, work_map_id):
    return visible_work_maps(user=request.user, slug=slug, project_id=project_id).filter(id=work_map_id).first()


def _readable_bindings(*, request, document, node_keys):
    bindings = {
        binding.node_key: binding
        for binding in WorkMapBinding.objects.filter(work_map=document.work_map, node_key__in=node_keys)
    }
    readable = {}
    for source_kind in WorkMapBinding.SourceKind.values:
        kind_bindings = [binding for binding in bindings.values() if binding.source_kind == source_kind]
        if not kind_bindings:
            continue
        sources = readable_work_map_sources(
            user=request.user,
            workspace_id=document.workspace_id,
            source_kind=source_kind,
            source_ids=[binding.source_id for binding in kind_bindings],
        )
        by_id = {source.id: (source, project) for source, project in sources}
        for binding in kind_bindings:
            if binding.source_id in by_id:
                readable[binding.node_key] = (binding, *by_id[binding.source_id])
    return readable


class WorkMapSourceDiscoveryEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, work_map_id):
        serializer = WorkMapSourceDiscoverySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        document = _visible_work_map(request, slug, project_id, work_map_id)
        if document is None:
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
        data = serializer.validated_data
        sources = readable_work_map_sources(
            user=request.user,
            workspace_id=document.workspace_id,
            source_kind=data["source_kind"],
            query=data["query"],
            project_id=data.get("project_id"),
            limit=20,
        )
        return Response(
            {"results": [_source_projection(data["source_kind"], source, project) for source, project in sources]},
            status=status.HTTP_200_OK,
        )


class WorkMapBindingHydrationEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, work_map_id):
        serializer = WorkMapBindingHydrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        document = _visible_work_map(request, slug, project_id, work_map_id)
        if document is None:
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
        node_keys = serializer.validated_data["node_keys"]
        readable = _readable_bindings(request=request, document=document, node_keys=node_keys)
        results = []
        for node_key in node_keys:
            resolved = readable.get(node_key)
            if resolved is None:
                results.append(_unavailable(node_key))
                continue
            binding, source, project = resolved
            results.append(
                {
                    "node_key": node_key,
                    "available": True,
                    "revision": binding.revision,
                    "source": _source_projection(binding.source_kind, source, project),
                }
            )
        return Response({"results": results}, status=status.HTTP_200_OK)


class WorkMapBindingOpenEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, work_map_id):
        serializer = WorkMapBindingOpenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        document = _visible_work_map(request, slug, project_id, work_map_id)
        if document is None:
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
        node_key = serializer.validated_data["node_key"]
        resolved = _readable_bindings(request=request, document=document, node_keys=[node_key]).get(node_key)
        if resolved is None:
            return Response(_unavailable(node_key), status=status.HTTP_200_OK)
        binding, source, project = resolved
        return Response(
            {
                "node_key": node_key,
                "available": True,
                "action": {
                    "source_kind": binding.source_kind,
                    "source_id": source.issue_id if binding.source_kind == "intake-item" else source.id,
                    "project_id": project.id,
                },
            },
            status=status.HTTP_200_OK,
        )
