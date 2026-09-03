# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Unit tests for APIKeyAuthentication.

Covers the access-control guarantees of the external API key authentication:
- a valid token belonging to an active user authenticates successfully
- a valid token is rejected once the underlying user account is deactivated
  (prevents an authentication bypass via a disabled account that still holds
  a previously generated API key)
"""

import pytest
from rest_framework.exceptions import AuthenticationFailed

from plane.api.middleware.api_authentication import APIKeyAuthentication
from plane.db.models import APIToken, Workspace


@pytest.mark.unit
class TestAPIKeyAuthentication:
    @pytest.mark.django_db
    def test_validate_api_token_authenticates_active_user(self, create_user):
        token = APIToken.objects.create(user=create_user, label="Active Token", token="active-user-token")

        user, returned_token = APIKeyAuthentication().validate_api_token(token.token)

        assert user == create_user
        assert returned_token == token.token

    @pytest.mark.django_db
    def test_human_global_token_is_not_workspace_scoped(self, create_user):
        token = APIToken.objects.create(user=create_user, label="Global Token", token="global-human-token")

        user, returned_token = APIKeyAuthentication().validate_api_token(token.token, "another-workspace")

        assert user == create_user
        assert returned_token == token.token

    @pytest.mark.django_db
    def test_validate_api_token_rejects_deactivated_user(self, create_user):
        token = APIToken.objects.create(user=create_user, label="Stale Token", token="deactivated-user-token")

        # Account is deactivated by an administrator after the token was issued.
        create_user.is_active = False
        create_user.save()

        with pytest.raises(AuthenticationFailed):
            APIKeyAuthentication().validate_api_token(token.token)

    @pytest.mark.django_db
    def test_non_full_token_requires_and_enforces_workspace(self, create_user):
        workspace = Workspace.objects.create(name="Scoped", slug="scoped", owner=create_user)
        token = APIToken.objects.create(
            user=create_user,
            label="Lifecycle",
            purpose=APIToken.Purpose.AGENT_LIFECYCLE,
            workspace=workspace,
        )
        path = "/api/v1/workspaces/scoped/agent-memberships/agent-a/"

        user, _ = APIKeyAuthentication().validate_api_token(token.token, workspace.slug, path, "PUT")
        assert user == create_user
        token.last_used = None
        token.save(update_fields=["last_used"])

        with pytest.raises(AuthenticationFailed, match="workspace"):
            APIKeyAuthentication().validate_api_token(token.token, "other", path, "PUT")
        token.refresh_from_db()
        assert token.last_used is None

        token.workspace = None
        token.save(update_fields=["workspace"])
        with pytest.raises(AuthenticationFailed, match="workspace"):
            APIKeyAuthentication().validate_api_token(token.token, workspace.slug, path, "PUT")
