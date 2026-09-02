# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.permissions.document import visible_documents
from plane.app.serializers import (
    WorkMapCreateSerializer,
    WorkMapUpdateSerializer,
)
from plane.bgtasks.recent_visited_task import recent_visited_task
from plane.db.models import (
    Document,
    DocumentProject,
    Project,
    ProjectMember,
    UserFavorite,
    UserRecentVisit,
    WorkMap,
    WorkspaceMember,
)

from ..base import BaseViewSet


def visible_work_maps(*, user, slug, project_id):
    favorite = UserFavorite.objects.filter(
        user=user,
        entity_type="work_map",
        entity_identifier=OuterRef("pk"),
        workspace__slug=slug,
    )
    return (
        visible_documents(user=user, slug=slug, project_id=project_id)
        .filter(
            kind=Document.Kind.WORK_MAP,
        )
        .select_related("work_map")
        .annotate(is_favorite=Exists(favorite))
        .distinct()
    )


def serialize_work_map(document):
    return {
        "id": document.id,
        "name": document.name,
        "owned_by": document.owned_by_id,
        "access": document.access,
        "archived_at": document.archived_at,
        "is_locked": document.is_locked,
        "sort_order": document.sort_order,
        "generation": document.work_map.generation,
        "collaboration_epoch": document.work_map.collaboration_epoch,
        "is_favorite": document.is_favorite if hasattr(document, "is_favorite") else False,
        "created_at": document.created_at,
        "updated_at": document.updated_at,
    }


def locked_owner_managed_work_map(*, user, slug, project_id, work_map_id):
    visible_id = (
        visible_work_maps(user=user, slug=slug, project_id=project_id)
        .filter(id=work_map_id)
        .values_list("id", flat=True)
        .first()
    )
    document = Document.objects.select_for_update().filter(id=visible_id).first()
    if document is None:
        return None, Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
    project_admin = ProjectMember.objects.filter(
        workspace__slug=slug,
        project_id=project_id,
        member=user,
        role=ROLE.ADMIN.value,
        is_active=True,
    ).exists()
    workspace_admin = (
        WorkspaceMember.objects.filter(
            workspace__slug=slug,
            member=user,
            role=ROLE.ADMIN.value,
            is_active=True,
        ).exists()
        and ProjectMember.objects.filter(
            workspace__slug=slug,
            project_id=project_id,
            member=user,
            is_active=True,
        ).exists()
    )
    if document.owned_by_id != user.id and not (project_admin or workspace_admin):
        return None, Response(
            {"error": "Only admin or owner can manage the work map"},
            status=status.HTTP_403_FORBIDDEN,
        )
    return document, None


class WorkMapViewSet(BaseViewSet):
    model = Document

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        return Response(
            [
                serialize_work_map(document)
                for document in visible_work_maps(user=request.user, slug=slug, project_id=project_id)
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
        return Response(serialize_work_map(document), status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def retrieve(self, request, slug, project_id, work_map_id):
        document = visible_work_maps(user=request.user, slug=slug, project_id=project_id).filter(id=work_map_id).first()
        if document is None:
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
        if request.query_params.get("track_visit", "true").lower() == "true":
            recent_visited_task.delay(
                slug=slug,
                entity_name="work_map",
                entity_identifier=work_map_id,
                user_id=request.user.id,
                project_id=project_id,
            )
        return Response(serialize_work_map(document), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def partial_update(self, request, slug, project_id, work_map_id):
        serializer = WorkMapUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            visible_id = (
                visible_work_maps(user=request.user, slug=slug, project_id=project_id)
                .filter(id=work_map_id)
                .values_list("id", flat=True)
                .first()
            )
            document = Document.objects.select_for_update().filter(id=visible_id).first()
            if document is None:
                return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
            if document.is_locked or document.archived_at is not None:
                return Response({"error": "Work map is not editable"}, status=status.HTTP_409_CONFLICT)
            if "access" in serializer.validated_data and document.owned_by_id != request.user.id:
                return Response({"error": "Only the owner can change access"}, status=status.HTTP_403_FORBIDDEN)
            for field, value in serializer.validated_data.items():
                setattr(document, field, value)
            document.updated_by = request.user
            document.save(update_fields=[*serializer.validated_data.keys(), "updated_by", "updated_at"])
        return Response(serialize_work_map(document), status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def lock(self, request, slug, project_id, work_map_id):
        return self._set_lock(request, slug, project_id, work_map_id, is_locked=True)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def unlock(self, request, slug, project_id, work_map_id):
        return self._set_lock(request, slug, project_id, work_map_id, is_locked=False)

    def _set_lock(self, request, slug, project_id, work_map_id, *, is_locked):
        with transaction.atomic():
            visible_id = (
                visible_work_maps(user=request.user, slug=slug, project_id=project_id)
                .filter(id=work_map_id)
                .values_list("id", flat=True)
                .first()
            )
            document = Document.objects.select_for_update().filter(id=visible_id).first()
            if document is None:
                return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
            work_map = WorkMap.objects.select_for_update().get(pk=document.id)
            if document.is_locked == is_locked:
                return Response(status=status.HTTP_204_NO_CONTENT)
            document.is_locked = is_locked
            document.updated_by = request.user
            document.save(update_fields=["is_locked", "updated_by", "updated_at"])
            work_map.collaboration_epoch += 1
            work_map.save(update_fields=["collaboration_epoch"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def archive(self, request, slug, project_id, work_map_id):
        with transaction.atomic():
            document, permission_error = locked_owner_managed_work_map(
                user=request.user,
                slug=slug,
                project_id=project_id,
                work_map_id=work_map_id,
            )
            if permission_error is not None:
                return permission_error
            archived_at = document.archived_at
            if archived_at is None:
                work_map = WorkMap.objects.select_for_update().get(pk=document.id)
                archived_at = timezone.localdate()
                document.archived_at = archived_at
                document.updated_by = request.user
                document.save(update_fields=["archived_at", "updated_by", "updated_at"])
                work_map.collaboration_epoch += 1
                work_map.save(update_fields=["collaboration_epoch"])
            UserFavorite.objects.filter(
                entity_type="work_map",
                entity_identifier=work_map_id,
                workspace__slug=slug,
            ).delete()
        return Response({"archived_at": archived_at}, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def unarchive(self, request, slug, project_id, work_map_id):
        with transaction.atomic():
            document, permission_error = locked_owner_managed_work_map(
                user=request.user,
                slug=slug,
                project_id=project_id,
                work_map_id=work_map_id,
            )
            if permission_error is not None:
                return permission_error
            if document.archived_at is None:
                return Response(status=status.HTTP_204_NO_CONTENT)
            work_map = WorkMap.objects.select_for_update().get(pk=document.id)
            document.archived_at = None
            document.updated_by = request.user
            document.save(update_fields=["archived_at", "updated_by", "updated_at"])
            work_map.collaboration_epoch += 1
            work_map.save(update_fields=["collaboration_epoch"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def destroy(self, request, slug, project_id, work_map_id):
        with transaction.atomic():
            document, permission_error = locked_owner_managed_work_map(
                user=request.user,
                slug=slug,
                project_id=project_id,
                work_map_id=work_map_id,
            )
            if permission_error is not None:
                return permission_error
            work_map = WorkMap.objects.select_for_update().get(pk=document.id)
            link = (
                DocumentProject.objects.select_for_update()
                .filter(
                    document=document,
                    project_id=project_id,
                    workspace__slug=slug,
                )
                .first()
            )
            if link is None:
                return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
            active_link_ids = list(
                DocumentProject.objects.select_for_update().filter(document=document).values_list("id", flat=True)
            )
            if len(active_link_ids) == 1 and document.archived_at is None:
                return Response(
                    {"error": "The work map should be archived before deleting"},
                    status=status.HTTP_409_CONFLICT,
                )
            UserFavorite.objects.filter(
                entity_type="work_map",
                entity_identifier=work_map_id,
                project_id=project_id,
                workspace__slug=slug,
            ).delete()
            UserRecentVisit.objects.filter(
                entity_name="work_map",
                entity_identifier=work_map_id,
                project_id=project_id,
                workspace__slug=slug,
            ).delete(soft=False)
            link.delete()
            work_map.collaboration_epoch += 1
            work_map.save(update_fields=["collaboration_epoch"])
            if len(active_link_ids) == 1:
                document.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
