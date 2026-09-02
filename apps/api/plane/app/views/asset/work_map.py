# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import uuid

from django.conf import settings
from django.db import transaction
from django.http import HttpResponseRedirect
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.permissions.document import visible_documents
from plane.app.serializers import WorkMapSceneAssetCreateSerializer, WorkMapSceneAssetSerializer
from plane.db.models import Document, FileAsset, WorkMap, WorkMapSceneAssetPlacement
from plane.settings.storage import S3Storage

from ..base import BaseAPIView
from ..work_map.scene import (
    LEGACY_SCENE_UPGRADE_ERROR,
    try_decode_work_map_scene,
    work_map_scene_assets,
)


def visible_work_map(request, slug, project_id, work_map_id):
    return (
        visible_documents(
            user=request.user,
            slug=slug,
            project_id=project_id,
        )
        .filter(id=work_map_id, kind=Document.Kind.WORK_MAP)
        .first()
    )


class WorkMapSceneAssetEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, work_map_id):
        serializer = WorkMapSceneAssetCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            visible_id = (
                visible_documents(user=request.user, slug=slug, project_id=project_id)
                .filter(id=work_map_id, kind=Document.Kind.WORK_MAP)
                .values_list("id", flat=True)
                .first()
            )
            document = Document.objects.select_for_update().filter(id=visible_id).first()
            if document is None:
                return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
            if document.is_locked or document.archived_at is not None:
                return Response({"error": "Work map is not editable"}, status=status.HTTP_409_CONFLICT)
            work_map = WorkMap.objects.select_for_update().get(pk=document.id)
            if try_decode_work_map_scene(work_map.scene_binary) is None:
                return Response({"error": LEGACY_SCENE_UPGRADE_ERROR}, status=status.HTTP_409_CONFLICT)
            object_name = f"{document.workspace_id}/{uuid.uuid4().hex}-{data['name']}"
            asset = FileAsset.objects.create(
                attributes={
                    "name": data["name"],
                    "type": data["mime_type"],
                    "size": data["size"],
                },
                asset=object_name,
                size=data["size"],
                workspace=document.workspace,
                document=document,
                created_by=request.user,
                entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
            )
        upload_data = S3Storage(request=request).generate_presigned_post(
            object_name=object_name,
            file_type=data["mime_type"],
            file_size=data["size"],
        )
        if upload_data is None:
            asset.delete(soft=False)
            return Response({"error": "Asset upload is unavailable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(
            {
                "asset": WorkMapSceneAssetSerializer(asset, context={"project_id": project_id}).data,
                "upload_data": upload_data,
            },
            status=status.HTTP_201_CREATED,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, work_map_id, asset_id):
        document = visible_work_map(request, slug, project_id, work_map_id)
        if document is None:
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
        asset = FileAsset.objects.filter(
            id=asset_id,
            document=document,
            workspace=document.workspace,
            entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
            is_deleted=False,
            deleted_at__isnull=True,
        ).first()
        if asset is None:
            return Response({"error": "Asset not found"}, status=status.HTTP_404_NOT_FOUND)

        metadata = S3Storage(request=request).get_object_metadata(asset.asset.name)
        if metadata is None:
            return Response({"error": "Uploaded asset not found"}, status=status.HTTP_409_CONFLICT)
        with transaction.atomic():
            visible_id = (
                visible_documents(user=request.user, slug=slug, project_id=project_id)
                .filter(id=work_map_id, kind=Document.Kind.WORK_MAP)
                .values_list("id", flat=True)
                .first()
            )
            document = Document.objects.select_for_update().filter(id=visible_id).first()
            if document is None:
                return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
            if document.is_locked or document.archived_at is not None:
                return Response({"error": "Work map is not editable"}, status=status.HTTP_409_CONFLICT)
            work_map = WorkMap.objects.select_for_update().get(pk=document.id)
            if try_decode_work_map_scene(work_map.scene_binary) is None:
                return Response({"error": LEGACY_SCENE_UPGRADE_ERROR}, status=status.HTTP_409_CONFLICT)
            asset = (
                FileAsset.objects.select_for_update()
                .filter(
                    id=asset_id,
                    document=document,
                    workspace=document.workspace,
                    entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
                    is_deleted=False,
                    deleted_at__isnull=True,
                )
                .first()
            )
            if asset is None:
                return Response({"error": "Asset not found"}, status=status.HTTP_404_NOT_FOUND)
            content_length = metadata.get("ContentLength")
            content_type = metadata.get("ContentType")
            if (
                isinstance(content_length, bool)
                or not isinstance(content_length, (int, float))
                or content_length < 1
                or content_length > asset.size
                or content_type != asset.attributes.get("type")
            ):
                return Response(
                    {"error": "Uploaded asset does not match its declaration"},
                    status=status.HTTP_409_CONFLICT,
                )
            asset.size = content_length
            asset.attributes = {**asset.attributes, "size": content_length}
            asset.storage_metadata = metadata
            asset.is_uploaded = True
            asset.updated_by = request.user
            asset.save(
                update_fields=[
                    "size",
                    "attributes",
                    "storage_metadata",
                    "is_uploaded",
                    "updated_by",
                    "updated_at",
                ]
            )
            WorkMapSceneAssetPlacement.objects.get_or_create(
                work_map_id=document.id,
                asset=asset,
                defaults={"created_by": request.user},
            )
        return Response(
            WorkMapSceneAssetSerializer(asset, context={"project_id": project_id}).data,
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, work_map_id, asset_id):
        document = visible_work_map(request, slug, project_id, work_map_id)
        if document is None:
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
        asset = FileAsset.objects.filter(
            id=asset_id,
            document=document,
            workspace=document.workspace,
            entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
            is_uploaded=True,
            is_deleted=False,
            deleted_at__isnull=True,
        ).first()
        if asset is None:
            return Response({"error": "Asset not found"}, status=status.HTTP_404_NOT_FOUND)
        mime_type = (asset.attributes.get("type") or "").split(";", 1)[0].strip().lower()
        disposition = "attachment" if mime_type in settings.SCRIPT_CAPABLE_MIME_TYPES else "inline"
        signed_url = S3Storage(request=request).generate_presigned_url(
            object_name=asset.asset.name,
            disposition=disposition,
            filename=asset.attributes.get("name"),
        )
        if signed_url is None:
            return Response({"error": "Asset download is unavailable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return HttpResponseRedirect(signed_url)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, work_map_id, asset_id):
        storage = S3Storage(request=request)
        deletion_marker = timezone.now()
        with transaction.atomic():
            visible_id = (
                visible_documents(user=request.user, slug=slug, project_id=project_id)
                .filter(id=work_map_id, kind=Document.Kind.WORK_MAP)
                .values_list("id", flat=True)
                .first()
            )
            document = Document.objects.select_for_update().filter(id=visible_id).first()
            if document is None:
                return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
            if document.is_locked or document.archived_at is not None:
                return Response({"error": "Work map is not editable"}, status=status.HTTP_409_CONFLICT)
            asset = (
                FileAsset.all_objects.select_for_update()
                .filter(
                    id=asset_id,
                    document=document,
                    workspace=document.workspace,
                    entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
                )
                .first()
            )
            if asset is None:
                return Response({"error": "Asset not found"}, status=status.HTTP_404_NOT_FOUND)
            if asset.deleted_at is None:
                scene = try_decode_work_map_scene(document.work_map.scene_binary)
                if scene is None:
                    return Response({"error": LEGACY_SCENE_UPGRADE_ERROR}, status=status.HTTP_409_CONFLICT)
                try:
                    current_asset_ids = set(work_map_scene_assets(scene).values())
                except ValueError:
                    return Response({"error": "Work map scene is invalid"}, status=status.HTTP_409_CONFLICT)
                if asset.id in current_asset_ids or asset.document_version_links.exists():
                    return Response({"error": "Asset is still in use"}, status=status.HTTP_409_CONFLICT)
                asset.deleted_at = deletion_marker
                asset.is_deleted = True
                asset.updated_by = request.user
                asset.save(update_fields=["deleted_at", "is_deleted", "updated_by", "updated_at"])
                WorkMapSceneAssetPlacement.objects.filter(asset=asset).delete(soft=False)
            object_name = asset.asset.name

        if object_name and not storage.delete_files([object_name]):
            FileAsset.all_objects.filter(id=asset_id, deleted_at=deletion_marker).update(
                deleted_at=None,
                is_deleted=False,
            )
            return Response({"error": "Asset deletion is unavailable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(status=status.HTTP_204_NO_CONTENT)
