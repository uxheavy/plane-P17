# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

from rest_framework import status
from rest_framework.response import Response

from plane.api.services import (
    AgentProfileError,
    AgentProfileCanonicalInvalid,
    AgentProfileConflict,
    AgentProfileForbidden,
    AgentProfileInvalidRequest,
    AgentProfileMalformed,
    AgentProfileNotFound,
    AgentProfileUnavailable,
    AgentProfiles,
)
from plane.db.models import Workspace

from .base import BaseAPIView


class AgentProfileEndpoint(BaseAPIView):
    def get(self, request, slug, user_id):
        workspace = Workspace.objects.filter(slug=slug).first()
        if workspace is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            profile = AgentProfiles.read(
                workspace=workspace,
                requester=request.user,
                user_id=user_id,
            )
        except AgentProfileForbidden:
            return Response({"error": "Workspace membership required"}, status=status.HTTP_403_FORBIDDEN)
        except AgentProfileNotFound:
            return Response({"error": "Agent profile not found"}, status=status.HTTP_404_NOT_FOUND)
        except AgentProfileMalformed:
            return Response({"error": "Agent profile response was invalid"}, status=status.HTTP_502_BAD_GATEWAY)
        except AgentProfileCanonicalInvalid:
            return Response(
                {"error": "Agent profile configuration is invalid"}, status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )
        except AgentProfileUnavailable:
            return Response({"error": "Agent profile service unavailable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(profile, status=status.HTTP_200_OK)

    def patch(self, request, slug, user_id):
        workspace = Workspace.objects.filter(slug=slug).first()
        if workspace is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        data = request.data
        if (
            not isinstance(data, dict)
            or set(data) != {"description", "expected_revision"}
            or not isinstance(data.get("description"), str)
            or "\x00" in data["description"]
            or not isinstance(data.get("expected_revision"), str)
        ):
            return Response({"error": "Invalid agent profile request"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            if len(data["description"].encode("utf-8")) > 8 * 1024:
                return Response({"error": "Invalid agent profile request"}, status=status.HTTP_400_BAD_REQUEST)
        except UnicodeEncodeError:
            return Response({"error": "Invalid agent profile request"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            profile = AgentProfiles.write(
                workspace=workspace,
                requester=request.user,
                user_id=user_id,
                description=data["description"],
                expected_revision=data["expected_revision"],
            )
        except AgentProfileForbidden:
            return Response({"error": "Workspace admin role 20 is required"}, status=status.HTTP_403_FORBIDDEN)
        except AgentProfileNotFound:
            return Response({"error": "Agent profile not found"}, status=status.HTTP_404_NOT_FOUND)
        except AgentProfileConflict:
            return Response({"error": "Agent profile revision is stale"}, status=status.HTTP_409_CONFLICT)
        except AgentProfileCanonicalInvalid:
            return Response(
                {"error": "Agent profile configuration is invalid"}, status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )
        except AgentProfileInvalidRequest:
            return Response({"error": "Invalid agent profile request"}, status=status.HTTP_400_BAD_REQUEST)
        except AgentProfileMalformed:
            return Response({"error": "Agent profile response was invalid"}, status=status.HTTP_502_BAD_GATEWAY)
        except AgentProfileUnavailable:
            return Response({"error": "Agent profile service unavailable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(profile, status=status.HTTP_200_OK)


class AgentProfileModelEndpoint(BaseAPIView):
    def get(self, request, slug, user_id):
        workspace = Workspace.objects.filter(slug=slug).first()
        if workspace is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            model = AgentProfiles.read_model(
                workspace=workspace,
                requester=request.user,
                user_id=user_id,
            )
        except AgentProfileForbidden:
            return Response({"error": "Workspace membership required"}, status=status.HTTP_403_FORBIDDEN)
        except AgentProfileNotFound:
            return Response({"error": "Agent profile not found"}, status=status.HTTP_404_NOT_FOUND)
        except AgentProfileMalformed:
            return Response({"error": "Agent profile response was invalid"}, status=status.HTTP_502_BAD_GATEWAY)
        except AgentProfileCanonicalInvalid:
            return Response(
                {"error": "Agent profile configuration is invalid"}, status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )
        except AgentProfileUnavailable:
            return Response({"error": "Agent profile service unavailable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(model, status=status.HTTP_200_OK)

    def patch(self, request, slug, user_id):
        workspace = Workspace.objects.filter(slug=slug).first()
        if workspace is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        data = request.data
        if (
            not isinstance(data, dict)
            or set(data) != {"provider", "model", "expected_revision"}
            or (data.get("provider") is not None and not isinstance(data.get("provider"), str))
            or (data.get("model") is not None and not isinstance(data.get("model"), str))
            or not isinstance(data.get("expected_revision"), str)
        ):
            return Response({"error": "Invalid agent profile model request"}, status=status.HTTP_400_BAD_REQUEST)
        if any("\x00" in value for value in (data.get("provider"), data.get("model")) if value is not None):
            return Response({"error": "Invalid agent profile model request"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            model = AgentProfiles.write_model(
                workspace=workspace,
                requester=request.user,
                user_id=user_id,
                provider=data.get("provider"),
                model=data.get("model"),
                expected_revision=data["expected_revision"],
            )
        except AgentProfileForbidden:
            return Response({"error": "Workspace admin role 20 is required"}, status=status.HTTP_403_FORBIDDEN)
        except AgentProfileNotFound:
            return Response({"error": "Agent profile not found"}, status=status.HTTP_404_NOT_FOUND)
        except AgentProfileConflict:
            return Response({"error": "Agent profile model revision is stale"}, status=status.HTTP_409_CONFLICT)
        except AgentProfileCanonicalInvalid:
            return Response(
                {"error": "Agent profile configuration is invalid"}, status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )
        except AgentProfileInvalidRequest:
            return Response({"error": "Invalid agent profile model request"}, status=status.HTTP_400_BAD_REQUEST)
        except AgentProfileMalformed:
            return Response({"error": "Agent profile response was invalid"}, status=status.HTTP_502_BAD_GATEWAY)
        except AgentProfileUnavailable:
            return Response({"error": "Agent profile service unavailable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(model, status=status.HTTP_200_OK)


def _skill_error(error, *, action):
    if isinstance(error, AgentProfileForbidden):
        message = "Workspace admin role 20 is required" if action != "read" else "Workspace membership required"
        return Response({"error": message}, status=status.HTTP_403_FORBIDDEN)
    if isinstance(error, AgentProfileNotFound):
        return Response({"error": "Agent profile not found"}, status=status.HTTP_404_NOT_FOUND)
    if isinstance(error, AgentProfileConflict):
        return Response({"error": "Agent profile skill revision is stale"}, status=status.HTTP_409_CONFLICT)
    if isinstance(error, AgentProfileCanonicalInvalid):
        return Response(
            {"error": "Agent profile skill configuration is invalid"}, status=status.HTTP_422_UNPROCESSABLE_ENTITY
        )
    if isinstance(error, AgentProfileInvalidRequest):
        return Response({"error": "Invalid agent profile skill request"}, status=status.HTTP_400_BAD_REQUEST)
    if isinstance(error, AgentProfileMalformed):
        return Response({"error": "Agent profile response was invalid"}, status=status.HTTP_502_BAD_GATEWAY)
    return Response({"error": "Agent profile service unavailable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


class AgentProfileSkillEndpoint(BaseAPIView):
    def get(self, request, slug, user_id, owner_id, skill_id):
        workspace = Workspace.objects.filter(slug=slug).first()
        if workspace is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        expected_revision = request.query_params.get("expected_revision")
        if not isinstance(expected_revision, str):
            return Response({"error": "Invalid agent profile skill request"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            skill = AgentProfiles.read_skill(
                workspace=workspace,
                requester=request.user,
                user_id=user_id,
                owner_id=owner_id,
                skill_id=skill_id,
                expected_revision=expected_revision,
            )
        except AgentProfileError as error:
            return _skill_error(error, action="read")
        return Response(skill, status=status.HTTP_200_OK)

    def patch(self, request, slug, user_id, owner_id, skill_id):
        workspace = Workspace.objects.filter(slug=slug).first()
        if workspace is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        data = request.data
        if (
            not isinstance(data, dict)
            or set(data) != {"content", "expected_revision"}
            or not isinstance(data.get("content"), str)
            or not isinstance(data.get("expected_revision"), str)
        ):
            return Response({"error": "Invalid agent profile skill request"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            skill = AgentProfiles.edit_skill(
                workspace=workspace,
                requester=request.user,
                user_id=user_id,
                owner_id=owner_id,
                skill_id=skill_id,
                expected_revision=data["expected_revision"],
                content=data["content"],
            )
        except AgentProfileError as error:
            return _skill_error(error, action="edit")
        return Response(skill, status=status.HTTP_200_OK)


class AgentProfileSkillPendingEndpoint(BaseAPIView):
    def get(self, request, slug, user_id):
        workspace = Workspace.objects.filter(slug=slug).first()
        if workspace is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            pending = AgentProfiles.pending_skills(
                workspace=workspace,
                requester=request.user,
                user_id=user_id,
                pending_id=request.query_params.get("pending_id"),
            )
        except AgentProfileError as error:
            return _skill_error(error, action="pending")
        return Response(pending, status=status.HTTP_200_OK)


class AgentProfileSkillApprovalEndpoint(BaseAPIView):
    def post(self, request, slug, user_id, pending_id):
        workspace = Workspace.objects.filter(slug=slug).first()
        if workspace is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        data = request.data
        if (
            not isinstance(data, dict)
            or set(data) != {"owner_id", "skill_id", "expected_revision", "content_revision"}
            or not all(
                isinstance(data.get(key), str)
                for key in ("owner_id", "skill_id", "expected_revision", "content_revision")
            )
        ):
            return Response({"error": "Invalid agent profile skill request"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = AgentProfiles.approve_skill(
                workspace=workspace,
                requester=request.user,
                user_id=user_id,
                pending_id=pending_id,
                owner_id=data["owner_id"],
                skill_id=data["skill_id"],
                expected_revision=data["expected_revision"],
                content_revision=data["content_revision"],
            )
        except AgentProfileError as error:
            return _skill_error(error, action="approve")
        return Response(result, status=status.HTTP_200_OK)


class AgentProfileSkillRejectionEndpoint(BaseAPIView):
    def post(self, request, slug, user_id, pending_id):
        workspace = Workspace.objects.filter(slug=slug).first()
        if workspace is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        data = request.data
        if (
            not isinstance(data, dict)
            or set(data) != {"owner_id", "skill_id", "expected_revision"}
            or not all(isinstance(data.get(key), str) for key in ("owner_id", "skill_id", "expected_revision"))
        ):
            return Response({"error": "Invalid agent profile skill request"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = AgentProfiles.reject_skill(
                workspace=workspace,
                requester=request.user,
                user_id=user_id,
                pending_id=pending_id,
                owner_id=data["owner_id"],
                skill_id=data["skill_id"],
                expected_revision=data["expected_revision"],
            )
        except AgentProfileError as error:
            return _skill_error(error, action="reject")
        return Response(result, status=status.HTTP_200_OK)
