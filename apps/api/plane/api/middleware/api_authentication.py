# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import re

# Django imports
from django.utils import timezone
from django.db.models import Q

# Third party imports
from rest_framework import authentication
from rest_framework.exceptions import AuthenticationFailed

# Module imports
from plane.db.models import APIToken, Issue


class APIKeyAuthentication(authentication.BaseAuthentication):
    """
    Authentication with an API Key
    """

    www_authenticate_realm = "api"
    media_type = "application/json"
    auth_header_name = "X-Api-Key"

    def get_api_token(self, request):
        return request.headers.get(self.auth_header_name)

    @staticmethod
    def _purpose_allows(api_token, path, method):
        if api_token.purpose == APIToken.Purpose.FULL:
            return True
        if api_token.purpose == APIToken.Purpose.AGENT_LIFECYCLE:
            return method == "PUT" and bool(re.fullmatch(r"/api/v1/workspaces/[^/]+/agent-memberships/[^/]+/?", path))
        if api_token.purpose == APIToken.Purpose.AGENT_RUNTIME:
            if method == "GET" and path.rstrip("/") == "/api/v1/users/me":
                return True
            if method == "GET" and re.fullmatch(r"/api/v1/workspaces/[^/]+/projects/[^/]+/members/?", path):
                return True
            match = re.fullmatch(
                r"/api/v1/workspaces/(?P<workspace_slug>[^/]+)/projects/(?P<project_id>[^/]+)/"
                r"work-items/(?P<issue_id>[^/]+)/comments/?",
                path,
            )
            return (
                method in {"GET", "POST"}
                and bool(match)
                and Issue.objects.filter(
                    id=match.group("issue_id"),
                    project_id=match.group("project_id"),
                    project__workspace_id=api_token.workspace_id,
                    project__workspace__slug=match.group("workspace_slug"),
                ).exists()
            )
        return False

    def validate_api_token(self, token, workspace_slug=None, path="", method="GET"):
        try:
            api_token = APIToken.objects.select_related("user", "workspace").get(
                Q(Q(expired_at__gt=timezone.now()) | Q(expired_at__isnull=True)),
                token=token,
                is_active=True,
                user__is_active=True,
            )
        except APIToken.DoesNotExist:
            raise AuthenticationFailed("Given API token is not valid")

        if path and not self._purpose_allows(api_token, path, method):
            raise AuthenticationFailed("Given API token is not valid for this operation")

        if api_token.purpose != APIToken.Purpose.FULL:
            if api_token.workspace is None:
                raise AuthenticationFailed("Given API token is not valid for this workspace")
            users_me = (
                api_token.purpose == APIToken.Purpose.AGENT_RUNTIME
                and method == "GET"
                and path.rstrip("/") == "/api/v1/users/me"
            )
            if not users_me and (workspace_slug is None or api_token.workspace.slug != workspace_slug):
                raise AuthenticationFailed("Given API token is not valid for this workspace")

        # save api token last used
        api_token.last_used = timezone.now()
        api_token.save(update_fields=["last_used"])
        return (api_token.user, api_token.token)

    def authenticate(self, request):
        token = self.get_api_token(request=request)
        if not token:
            return None

        # Validate the API token
        parser_context = request.parser_context or {}
        workspace_slug = (parser_context.get("kwargs") or {}).get("slug")
        user, token = self.validate_api_token(token, workspace_slug, request.path, request.method)
        return user, token
