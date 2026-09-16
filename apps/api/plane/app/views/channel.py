# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

from rest_framework import serializers, status
from rest_framework.response import Response

from plane.api.services import (
    ChannelMessages,
    MessageCursorError,
    MessageParentError,
    MessageAttachmentError,
    MessageReplayConflict,
    MessageThreadNotFound,
    MessageThreadRootRequired,
)
from plane.app.permissions import ChannelPermission
from plane.app.serializers import (
    ChannelCreateSerializer,
    ChannelSerializer,
    MessageCreateSerializer,
    MessageSerializer,
)
from plane.db.models import Channel, Workspace

from .base import BaseAPIView


def _message_page_response(page):
    return {
        "results": MessageSerializer(page["messages"], many=True).data,
        "next_cursor": page["next_cursor"],
    }


class ChannelListCreateEndpoint(BaseAPIView):
    permission_classes = [ChannelPermission]

    def get(self, request, slug):
        channels = Channel.objects.filter(workspace__slug=slug).order_by("name", "id")
        return Response(ChannelSerializer(channels, many=True).data, status=status.HTTP_200_OK)

    def post(self, request, slug):
        serializer = ChannelCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        workspace = Workspace.objects.filter(slug=slug).first()
        if workspace is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)

        channel = Channel(
            workspace=workspace,
            name=serializer.validated_data["name"],
        )
        channel.save(created_by_id=request.user.id)
        return Response(ChannelSerializer(channel).data, status=status.HTTP_201_CREATED)


class ChannelMessageListCreateEndpoint(BaseAPIView):
    permission_classes = [ChannelPermission]

    def _channel(self, channel_id):
        return Channel.objects.filter(id=channel_id).first()

    def get(self, request, channel_id):
        channel = self._channel(channel_id)
        if channel is None:
            return Response({"error": "Channel not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            page = ChannelMessages.list_roots(
                channel=channel,
                user=request.user,
                cursor=request.query_params.get("cursor"),
            )
        except MessageCursorError as error:
            raise serializers.ValidationError(str(error))
        return Response(_message_page_response(page), status=status.HTTP_200_OK)

    def post(self, request, channel_id):
        channel = self._channel(channel_id)
        if channel is None:
            return Response({"error": "Channel not found"}, status=status.HTTP_404_NOT_FOUND)

        serializer = MessageCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            message, created = ChannelMessages.create(
                channel=channel,
                user=request.user,
                content=serializer.validated_data["content"],
                parent_id=serializer.validated_data["parent_id"],
                client_id=serializer.validated_data["client_id"],
                attachment_ids=serializer.validated_data["attachment_ids"],
            )
        except MessageAttachmentError as error:
            raise serializers.ValidationError(str(error))
        except MessageParentError as error:
            raise serializers.ValidationError({"parent_id": str(error)})
        except MessageReplayConflict:
            return Response(
                {"error": "client_id was already used with different content or parent"},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(
            MessageSerializer(message).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class ChannelThreadMessageListEndpoint(BaseAPIView):
    permission_classes = [ChannelPermission]

    def get(self, request, channel_id, root_id):
        channel = Channel.objects.filter(id=channel_id).first()
        if channel is None:
            return Response({"error": "Channel not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            page = ChannelMessages.list_thread(
                channel=channel,
                root_id=root_id,
                user=request.user,
                cursor=request.query_params.get("cursor"),
            )
        except MessageThreadNotFound:
            return Response({"error": "Root message not found"}, status=status.HTTP_404_NOT_FOUND)
        except MessageThreadRootRequired:
            return Response(
                {"error": "root_id must reference a root message"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except MessageCursorError as error:
            raise serializers.ValidationError(str(error))
        return Response(
            _message_page_response(page),
            status=status.HTTP_200_OK,
        )
