# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

import uuid

from django.conf import settings
from django.db.models import Q
from django.http import HttpResponseRedirect
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.response import Response

from plane.app.permissions import ChannelPermission
from plane.app.serializers import ChannelAttachmentCreateSerializer, ChannelAttachmentSerializer
from plane.db.models import Channel, FileAsset
from plane.settings.storage import S3Storage
from plane.utils.path_validator import sanitize_filename

from .base import BaseAPIView


class ChannelAttachmentEndpoint(BaseAPIView):
    permission_classes = [ChannelPermission]

    def _channel(self, channel_id):
        return Channel.objects.filter(id=channel_id).first()

    def _asset(self, channel, asset_id):
        return (
            FileAsset.objects.select_related("message")
            .filter(
                id=asset_id,
                channel=channel,
                entity_type=FileAsset.EntityTypeContext.MESSAGE_ATTACHMENT,
                is_deleted=False,
            )
            .first()
        )

    def _is_visible(self, asset, user):
        if asset.message_id is None:
            return asset.created_by_id == user.id
        return asset.message is not None and asset.message.deleted_at is None and asset.message.channel_id == asset.channel_id

    def post(self, request, channel_id):
        channel = self._channel(channel_id)
        if channel is None:
            return Response({"error": "Channel not found"}, status=status.HTTP_404_NOT_FOUND)

        serializer = ChannelAttachmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        name = sanitize_filename(serializer.validated_data["name"])
        mime_type = serializer.validated_data["mime_type"]
        size = serializer.validated_data["size"]
        if not name:
            raise serializers.ValidationError({"name": "A valid file name is required"})
        if mime_type not in settings.ATTACHMENT_MIME_TYPES:
            raise serializers.ValidationError({"mime_type": "Invalid file type"})
        if size > settings.FILE_SIZE_LIMIT:
            raise serializers.ValidationError({"size": "File is too large"})

        asset_key = f"{channel.workspace_id}/{uuid.uuid4().hex}-{name}"
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": mime_type, "size": size},
            asset=asset_key,
            size=size,
            workspace_id=channel.workspace_id,
            channel=channel,
            created_by=request.user,
            entity_type=FileAsset.EntityTypeContext.MESSAGE_ATTACHMENT,
        )
        upload_data = S3Storage(request=request).generate_presigned_post(
            object_name=asset_key,
            file_type=mime_type,
            file_size=size,
        )
        return Response(
            {"asset": ChannelAttachmentSerializer(asset).data, "upload_data": upload_data},
            status=status.HTTP_201_CREATED,
        )

    def get(self, request, channel_id, asset_id=None):
        channel = self._channel(channel_id)
        if channel is None:
            return Response({"error": "Channel not found"}, status=status.HTTP_404_NOT_FOUND)

        if asset_id is None:
            assets = FileAsset.objects.filter(
                channel=channel,
                entity_type=FileAsset.EntityTypeContext.MESSAGE_ATTACHMENT,
                is_uploaded=True,
                is_deleted=False,
            ).filter(
                Q(message__isnull=False, message__deleted_at__isnull=True)
                | Q(message__isnull=True, created_by=request.user)
            )
            return Response(ChannelAttachmentSerializer(assets, many=True).data, status=status.HTTP_200_OK)

        asset = self._asset(channel, asset_id)
        if asset is None or not self._is_visible(asset, request.user):
            return Response({"error": "Attachment not found"}, status=status.HTTP_404_NOT_FOUND)
        if not asset.is_uploaded:
            return Response(ChannelAttachmentSerializer(asset).data, status=status.HTTP_200_OK)
        signed_url = S3Storage(request=request).generate_presigned_url(
            object_name=asset.asset.name,
            disposition="attachment",
            filename=(asset.attributes or {}).get("name"),
        )
        return HttpResponseRedirect(signed_url)

    def patch(self, request, channel_id, asset_id):
        channel = self._channel(channel_id)
        if channel is None:
            return Response({"error": "Channel not found"}, status=status.HTTP_404_NOT_FOUND)
        asset = self._asset(channel, asset_id)
        if asset is None or asset.created_by_id != request.user.id or asset.message_id is not None:
            return Response({"error": "Attachment not found"}, status=status.HTTP_404_NOT_FOUND)
        if not asset.is_uploaded:
            metadata = S3Storage().get_object_metadata(object_name=asset.asset.name)
            if metadata is None:
                return Response({"error": "Uploaded object was not found"}, status=status.HTTP_400_BAD_REQUEST)
            if metadata.get("ContentLength") is not None and int(metadata["ContentLength"]) != int(asset.size):
                return Response({"error": "Uploaded object size does not match the reservation"}, status=status.HTTP_400_BAD_REQUEST)
            asset.is_uploaded = True
            asset.storage_metadata = metadata
            asset.save(update_fields=["is_uploaded", "storage_metadata", "updated_at"])
        return Response(ChannelAttachmentSerializer(asset).data, status=status.HTTP_200_OK)

    def delete(self, request, channel_id, asset_id):
        channel = self._channel(channel_id)
        if channel is None:
            return Response({"error": "Channel not found"}, status=status.HTTP_404_NOT_FOUND)
        asset = self._asset(channel, asset_id)
        if asset is None or asset.created_by_id != request.user.id or asset.message_id is not None:
            return Response({"error": "Attachment not found"}, status=status.HTTP_404_NOT_FOUND)
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        asset.save(update_fields=["is_deleted", "deleted_at", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)
