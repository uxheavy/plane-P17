# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import base64

from django.db import IntegrityError, transaction
from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.permissions.work_map import can_read_work_map_source
from plane.app.serializers import (
    WorkMapBindingCreateSerializer,
    WorkMapCreateSerializer,
    WorkMapSceneSerializer,
    WorkMapUpdateSerializer,
)
from plane.db.models import Document, DocumentProject, Project, WorkMap, WorkMapBinding

from .base import BaseAPIView, BaseViewSet


def _visible_work_maps(*, user, slug, project_id):
    return (
        Document.objects.filter(
            kind=Document.Kind.WORK_MAP,
            workspace__slug=slug,
            document_projects__project_id=project_id,
            document_projects__deleted_at__isnull=True,
            document_projects__project__project_projectmember__member=user,
            document_projects__project__project_projectmember__is_active=True,
        )
        .filter(Q(owned_by=user) | Q(access=Document.PUBLIC_ACCESS))
        .select_related("work_map")
        .distinct()
    )


def _serialize_work_map(document):
    return {
        "id": document.id,
        "name": document.name,
        "owned_by": document.owned_by_id,
        "access": document.access,
        "archived_at": document.archived_at,
        "is_locked": document.is_locked,
        "sort_order": document.sort_order,
        "generation": document.work_map.generation,
        "created_at": document.created_at,
        "updated_at": document.updated_at,
    }


class WorkMapViewSet(BaseViewSet):
    model = Document

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        return Response(
            [
                _serialize_work_map(document)
                for document in _visible_work_maps(user=request.user, slug=slug, project_id=project_id)
            ],
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id):
        serializer = WorkMapCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            project = Project.objects.select_related("workspace").get(id=project_id, workspace__slug=slug)
            document = Document.objects.create(
                kind=Document.Kind.WORK_MAP,
                workspace=project.workspace,
                owned_by=request.user,
                created_by=request.user,
                name=serializer.validated_data["name"],
                access=serializer.validated_data["access"],
            )
            WorkMap.objects.create(document=document)
            DocumentProject.objects.create(
                document=document,
                project=project,
                workspace=project.workspace,
                created_by=request.user,
            )
        return Response(_serialize_work_map(document), status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def retrieve(self, request, slug, project_id, work_map_id):
        document = (
            _visible_work_maps(user=request.user, slug=slug, project_id=project_id).filter(id=work_map_id).first()
        )
        if document is None:
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(_serialize_work_map(document), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def partial_update(self, request, slug, project_id, work_map_id):
        document = (
            _visible_work_maps(user=request.user, slug=slug, project_id=project_id).filter(id=work_map_id).first()
        )
        if document is None:
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
        serializer = WorkMapUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if "access" in serializer.validated_data and document.owned_by_id != request.user.id:
            return Response({"error": "Only the owner can change access"}, status=status.HTTP_403_FORBIDDEN)
        for field, value in serializer.validated_data.items():
            setattr(document, field, value)
        document.updated_by = request.user
        document.save(update_fields=[*serializer.validated_data.keys(), "updated_by", "updated_at"])
        return Response(_serialize_work_map(document), status=status.HTTP_200_OK)


class WorkMapSceneEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, work_map_id):
        document = (
            _visible_work_maps(user=request.user, slug=slug, project_id=project_id).filter(id=work_map_id).first()
        )
        if document is None:
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(
            {
                "generation": document.work_map.generation,
                "scene_binary": base64.b64encode(bytes(document.work_map.scene_binary)).decode("ascii"),
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, work_map_id):
        serializer = WorkMapSceneSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            visible_id = (
                _visible_work_maps(user=request.user, slug=slug, project_id=project_id)
                .filter(id=work_map_id)
                .values_list("id", flat=True)
                .first()
            )
            document = Document.objects.select_for_update().filter(id=visible_id).first()
            if document is None:
                return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
            if document.is_locked or document.archived_at is not None:
                return Response({"error": "Work map is not editable"}, status=status.HTTP_409_CONFLICT)
            work_map = WorkMap.objects.select_for_update().get(document=document)
            if serializer.validated_data["generation"] != work_map.generation:
                return Response(
                    {"error": "Work map generation is stale", "generation": work_map.generation},
                    status=status.HTTP_409_CONFLICT,
                )
            work_map.scene_binary = serializer.validated_data["scene_binary"]
            work_map.generation += 1
            work_map.save(update_fields=["scene_binary", "generation"])
            document.updated_by = request.user
            document.save(update_fields=["updated_by", "updated_at"])
        return Response({"generation": work_map.generation}, status=status.HTTP_200_OK)


class WorkMapBindingEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, work_map_id):
        serializer = WorkMapBindingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        document = (
            _visible_work_maps(user=request.user, slug=slug, project_id=project_id).filter(id=work_map_id).first()
        )
        if document is None:
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
        if document.is_locked or document.archived_at is not None:
            return Response({"error": "Work map is not editable"}, status=status.HTTP_409_CONFLICT)
        data = serializer.validated_data
        if not can_read_work_map_source(
            user=request.user,
            workspace_id=document.workspace_id,
            source_kind=data["source_kind"],
            source_id=data["source_id"],
        ):
            return Response({"error": "Source unavailable"}, status=status.HTTP_404_NOT_FOUND)
        try:
            with transaction.atomic():
                binding, created = WorkMapBinding.objects.get_or_create(
                    work_map=document.work_map,
                    source_kind=data["source_kind"],
                    source_id=data["source_id"],
                    defaults={"node_key": data["node_key"], "created_by": request.user},
                )
        except IntegrityError:
            return Response({"error": "Node key unavailable"}, status=status.HTTP_409_CONFLICT)
        return Response(
            {"node_key": binding.node_key, "revision": binding.revision},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
