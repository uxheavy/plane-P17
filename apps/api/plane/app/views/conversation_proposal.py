# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

from rest_framework import status
from rest_framework.response import Response

from plane.api.services import (
    ConversationProposalCanonicalInvalid,
    ConversationProposalConflict,
    ConversationProposalError,
    ConversationProposalForbidden,
    ConversationProposalInvalidRequest,
    ConversationProposalMalformed,
    ConversationProposalNotFound,
    ConversationProposalTooLarge,
    ConversationProposals,
)
from plane.app.permissions import ChannelPermission
from plane.app.serializers import ConversationProposalRequestSerializer
from plane.db.models import Channel

from .base import BaseAPIView


def _proposal_error(error):
    if isinstance(error, ConversationProposalForbidden):
        return Response({"error": "An active human channel member is required"}, status=status.HTTP_403_FORBIDDEN)
    if isinstance(error, ConversationProposalNotFound):
        return Response(
            {"error": "Conversation source or agent was not found"},
            status=status.HTTP_404_NOT_FOUND,
        )
    if isinstance(error, ConversationProposalConflict):
        return Response(
            {"error": "Conversation proposal request conflicts with an existing request"},
            status=status.HTTP_409_CONFLICT,
        )
    if isinstance(error, ConversationProposalInvalidRequest):
        return Response(
            {"error": str(error) or "Invalid conversation proposal request"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if isinstance(error, ConversationProposalTooLarge):
        return Response(
            {"error": "Conversation context exceeds the size limit"},
            status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )
    if isinstance(error, ConversationProposalCanonicalInvalid):
        return Response(
            {"error": "Conversation proposal configuration is invalid"},
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    if isinstance(error, ConversationProposalMalformed):
        return Response(
            {"error": "Conversation proposal response was invalid"},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    return Response(
        {"error": "Conversation proposal service unavailable"},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


class ConversationProposalEndpoint(BaseAPIView):
    permission_classes = [ChannelPermission]

    def _channel(self, channel_id):
        return Channel.objects.select_related("workspace").filter(id=channel_id).first()

    def post(self, request, channel_id):
        channel = self._channel(channel_id)
        if channel is None:
            return Response({"error": "Channel not found"}, status=status.HTTP_404_NOT_FOUND)
        serializer = ConversationProposalRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = ConversationProposals.submit(
                channel=channel,
                requester=request.user,
                request_id=serializer.validated_data["request_id"],
                agent_user_id=serializer.validated_data["agent_user_id"],
                thread_id=serializer.validated_data["thread_id"],
            )
        except ConversationProposalError as error:
            return _proposal_error(error)
        response_status = (
            status.HTTP_202_ACCEPTED if result["status"] in {"accepted", "processing"} else status.HTTP_200_OK
        )
        return Response(result, status=response_status)

    def get(self, request, channel_id):
        channel = self._channel(channel_id)
        if channel is None:
            return Response({"error": "Channel not found"}, status=status.HTTP_404_NOT_FOUND)
        serializer = ConversationProposalRequestSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        try:
            result = ConversationProposals.read(
                channel=channel,
                requester=request.user,
                request_id=serializer.validated_data["request_id"],
                agent_user_id=serializer.validated_data["agent_user_id"],
                thread_id=serializer.validated_data["thread_id"],
            )
        except ConversationProposalError as error:
            return _proposal_error(error)
        return Response(result, status=status.HTTP_200_OK)
