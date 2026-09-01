# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python import
from uuid import uuid4
from typing import Optional

# Third party
from rest_framework.response import Response
from rest_framework.request import Request
from rest_framework import status

# Module import
from .base import BaseAPIView
from plane.db.models import APIToken, WorkspaceMember
from plane.app.serializers import APITokenSerializer, APITokenReadSerializer


class ApiTokenEndpoint(BaseAPIView):
    def post(self, request: Request) -> Response:
        label = request.data.get("label", str(uuid4().hex))
        description = request.data.get("description", "")
        expired_at = request.data.get("expired_at", None)
        purpose = request.data.get("purpose", APIToken.Purpose.FULL)
        workspace_slug = request.data.get("workspace_slug")

        if purpose not in {APIToken.Purpose.FULL, APIToken.Purpose.AGENT_LIFECYCLE}:
            return Response({"error": "Token purpose is not available"}, status=status.HTTP_400_BAD_REQUEST)

        workspace = None
        if purpose == APIToken.Purpose.AGENT_LIFECYCLE:
            if not isinstance(workspace_slug, str) or not workspace_slug:
                return Response({"error": "Workspace is required"}, status=status.HTTP_400_BAD_REQUEST)
            membership = (
                WorkspaceMember.objects.select_related("workspace")
                .filter(
                    workspace__slug=workspace_slug,
                    member=request.user,
                    role=20,
                    is_active=True,
                )
                .first()
            )
            if membership is None:
                return Response(
                    {"error": "Workspace admin role 20 is required"},
                    status=status.HTTP_403_FORBIDDEN,
                )
            workspace = membership.workspace
        elif workspace_slug is not None:
            return Response(
                {"error": "Full tokens cannot be workspace-scoped"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check the user type
        user_type = 1 if request.user.is_bot else 0

        api_token = APIToken.objects.create(
            label=label,
            description=description,
            user=request.user,
            user_type=user_type,
            expired_at=expired_at,
            workspace=workspace,
            purpose=purpose,
        )

        serializer = APITokenSerializer(api_token)
        # Token will be only visible while creating
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def get(self, request: Request, pk: Optional[str] = None) -> Response:
        if pk is None:
            api_tokens = APIToken.objects.filter(user=request.user, is_service=False)
            serializer = APITokenReadSerializer(api_tokens, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)
        else:
            api_tokens = APIToken.objects.get(user=request.user, pk=pk, is_service=False)
            serializer = APITokenReadSerializer(api_tokens)
            return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request: Request, pk: str) -> Response:
        api_token = APIToken.objects.get(user=request.user, pk=pk, is_service=False)
        api_token.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def patch(self, request: Request, pk: str) -> Response:
        api_token = APIToken.objects.get(user=request.user, pk=pk, is_service=False)
        serializer = APITokenSerializer(api_token, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
