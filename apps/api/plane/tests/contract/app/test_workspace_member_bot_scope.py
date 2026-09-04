# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

import pytest
from rest_framework import status

from plane.db.models import BotTypeEnum, User
from plane.tests.factories import UserFactory, WorkspaceMemberFactory


MEMBER_URL = "/api/workspaces/{slug}/members/{member_id}/"


def _member_url(workspace, member):
    return MEMBER_URL.format(slug=workspace.slug, member_id=member.id)


@pytest.mark.contract
@pytest.mark.django_db
@pytest.mark.parametrize(
    ("method", "expected_status"),
    (("patch", status.HTTP_200_OK), ("delete", status.HTTP_204_NO_CONTENT)),
)
def test_workspace_member_mutations_keep_humans_in_scope(session_client, workspace, method, expected_status):
    human = UserFactory(username="workspace-human")
    membership = WorkspaceMemberFactory(workspace=workspace, member=human, role=15)

    response = getattr(session_client, method)(_member_url(workspace, membership), {"role": 15}, format="json")

    assert response.status_code == expected_status


@pytest.mark.contract
@pytest.mark.django_db
@pytest.mark.parametrize("method", ("patch", "delete"))
def test_workspace_member_mutations_route_native_agents_to_lifecycle(method, session_client, workspace):
    agent = UserFactory(username="workspace-agent", is_bot=True, bot_type=BotTypeEnum.AGENT)
    membership = WorkspaceMemberFactory(workspace=workspace, member=agent, role=15)

    response = getattr(session_client, method)(_member_url(workspace, membership), {"role": 15}, format="json")

    assert response.status_code == status.HTTP_409_CONFLICT
    membership.refresh_from_db()
    assert membership.is_active


@pytest.mark.contract
@pytest.mark.django_db
@pytest.mark.parametrize("method", ("patch", "delete"))
def test_workspace_member_mutations_hide_internal_bots(method, session_client, workspace):
    seed = User.objects.create(
        username="workspace-seed",
        email="workspace-seed@plane.so",
        is_bot=True,
        bot_type=BotTypeEnum.WORKSPACE_SEED,
    )
    membership = WorkspaceMemberFactory(workspace=workspace, member=seed, role=15)

    response = getattr(session_client, method)(_member_url(workspace, membership), {"role": 15}, format="json")

    assert response.status_code == status.HTTP_404_NOT_FOUND
    membership.refresh_from_db()
    assert membership.is_active
