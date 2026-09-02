# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from importlib import import_module
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from django.conf import settings
from django.db import DatabaseError, IntegrityError, close_old_connections, connection, transaction
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from plane.api.middleware.api_authentication import APIKeyAuthentication
from plane.api.views.issue import IssueDetailAPIEndpoint
from plane.api.services import AgentMembershipConflict, AgentMembershipError, WorkspaceAgentMemberships
from plane.api.services.agent_membership import MAX_AGENT_KEY_LENGTH
from plane.api.serializers import IssueCommentSerializer
from plane.bgtasks.webhook_task import get_model_data, webhook_send_task
from plane.bgtasks.deletion_task import hard_delete, soft_delete_related_objects
from plane.db.models import (
    APIToken,
    BotTypeEnum,
    Issue,
    IssueComment,
    ProjectMember,
    State,
    User,
    Webhook,
    WorkspaceAgentMembership,
    WorkspaceAgentMembershipReceipt,
    WorkspaceMember,
)
from plane.tests.factories import (
    ProjectFactory,
    ProjectMemberFactory,
    UserFactory,
    WorkspaceFactory,
    WorkspaceMemberFactory,
)


def install_agent_membership_guards():
    operation = import_module("plane.db.migrations.0125_workspace_agent_membership").Migration.operations[-1]
    with connection.cursor() as cursor:
        cursor.execute(operation.reverse_sql)
        cursor.execute(operation.sql)


@pytest.mark.django_db
class TestWorkspaceAgentMemberships:
    def setup_method(self):
        self.admin = UserFactory()
        self.workspace = WorkspaceFactory(owner=self.admin)
        WorkspaceMemberFactory(workspace=self.workspace, member=self.admin, role=20)
        self.project = ProjectFactory(workspace=self.workspace)
        self.desired = {
            "display_name": "Agent Alpha",
            "state": "active",
            "project_ids": [str(self.project.id)],
            "credential_action": "ensure",
        }

    def apply(self, desired=None, key="operation-1", actor=None):
        return WorkspaceAgentMemberships.apply(
            workspace_id=self.workspace.id,
            agent_key="opaque-agent-key",
            desired=desired or self.desired,
            idempotency_key=key,
            actor=actor or self.admin,
        )

    def lifecycle_url(self, agent_key):
        return f"/api/v1/workspaces/{self.workspace.slug}/agent-memberships/{agent_key}/"

    def put_agent(self, client, agent_key, desired, key):
        return client.put(
            self.lifecycle_url(agent_key),
            desired,
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
        )

    def token_client(self, token):
        client = APIClient()
        client.credentials(HTTP_X_API_KEY=token)
        return client

    def test_two_agent_http_lifecycle_is_exact_atomic_and_idempotent(self):
        second_project = ProjectFactory(workspace=self.workspace)
        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)
        ordinary_member = UserFactory(username="ordinary-member-http")
        WorkspaceMemberFactory(workspace=self.workspace, member=ordinary_member, role=15)
        member_client = APIClient()
        member_client.force_authenticate(ordinary_member)
        desired = {
            "agent-a": {
                **self.desired,
                "display_name": "Agent A",
                "project_ids": [str(self.project.id), str(second_project.id)],
            },
            "agent-b": {
                **self.desired,
                "display_name": "Agent B",
                "project_ids": [str(self.project.id), str(second_project.id)],
            },
        }

        denied = self.put_agent(member_client, "agent-a", desired["agent-a"], "denied")
        assert denied.status_code == 403

        created = {key: self.put_agent(admin_client, key, value, f"create-{key}") for key, value in desired.items()}
        assert {response.status_code for response in created.values()} == {200}
        user_ids = {key: response.data["user_id"] for key, response in created.items()}
        credentials = {key: response.data["credential"] for key, response in created.items()}
        assert len(set(user_ids.values())) == 2
        assert all(value.startswith("plane_api_") for value in credentials.values())
        assert User.objects.filter(id__in=user_ids.values(), is_bot=True, bot_type=BotTypeEnum.AGENT).count() == 2
        for key, user_id in user_ids.items():
            assert (
                WorkspaceMember.objects.filter(workspace=self.workspace, member_id=user_id, is_active=True).count() == 1
            )
            assert set(
                ProjectMember.objects.filter(workspace=self.workspace, member_id=user_id, is_active=True).values_list(
                    "project_id", flat=True
                )
            ) == {uuid.UUID(value) for value in desired[key]["project_ids"]}
            assert (
                APIToken.objects.filter(
                    user_id=user_id,
                    is_active=True,
                    label__startswith="plane-agent-membership:",
                ).count()
                == 1
            )
            me = self.token_client(credentials[key]).get("/api/v1/users/me/")
            assert me.status_code == 200
            assert str(me.data["id"]) == user_id

        before = {
            model: model.objects.count()
            for model in (
                User,
                WorkspaceMember,
                ProjectMember,
                APIToken,
                WorkspaceAgentMembership,
                WorkspaceAgentMembershipReceipt,
            )
        }
        replay = {key: self.put_agent(admin_client, key, value, f"create-{key}") for key, value in desired.items()}
        assert all(response.data["replayed"] is True for response in replay.values())
        assert all(response.data["credential"] is None for response in replay.values())
        assert before == {model: model.objects.count() for model in before}

        reconciled = self.put_agent(
            admin_client,
            "agent-a",
            {**desired["agent-a"], "project_ids": [str(self.project.id)]},
            "reconcile-agent-a",
        )
        assert reconciled.status_code == 200
        assert set(
            ProjectMember.objects.filter(
                workspace=self.workspace,
                member_id=user_ids["agent-a"],
                is_active=True,
            ).values_list("project_id", flat=True)
        ) == {self.project.id}
        after_reconcile = {model: model.objects.count() for model in before}

        invalid = {
            **self.desired,
            "display_name": "Must Roll Back",
            "project_ids": [str(uuid.uuid4())],
        }
        failed = self.put_agent(admin_client, "invalid-agent", invalid, "invalid-project")
        assert failed.status_code == 400
        assert after_reconcile == {model: model.objects.count() for model in before}
        assert not User.objects.filter(display_name="Must Roll Back").exists()

    def test_rotation_and_disablement_apply_to_real_auth_and_preserve_history(self):
        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)
        created = self.put_agent(admin_client, "historian", self.desired, "create-historian")
        user_id = created.data["user_id"]
        old_token = created.data["credential"]
        agent = User.objects.get(id=user_id)
        issue = Issue.objects.create(
            name="Durable history",
            workspace=self.workspace,
            project=self.project,
            state=State.objects.create(
                name="Todo",
                workspace=self.workspace,
                project=self.project,
                group="backlog",
                default=True,
            ),
            created_by=self.admin,
        )
        authored = IssueComment(
            workspace=self.workspace,
            project=self.project,
            issue=issue,
            comment_html="<p>History remains</p>",
            comment_json={},
            created_by=agent,
            updated_by=agent,
        )
        authored.save(disable_auto_set_user=True)

        rotated = self.put_agent(
            admin_client,
            "historian",
            {**self.desired, "credential_action": "rotate"},
            "rotate-historian",
        )
        new_token = rotated.data["credential"]
        assert new_token != old_token
        assert self.token_client(old_token).get("/api/v1/users/me/").status_code in {401, 403}
        assert self.token_client(new_token).get("/api/v1/users/me/").status_code == 200
        token_count = APIToken.objects.filter(user_id=user_id).count()
        rotation_replay = self.put_agent(
            admin_client,
            "historian",
            {**self.desired, "credential_action": "rotate"},
            "rotate-historian",
        )
        assert rotation_replay.data["replayed"] is True
        assert rotation_replay.data["credential"] == new_token
        assert APIToken.objects.filter(user_id=user_id).count() == token_count

        disabled = self.put_agent(
            admin_client,
            "historian",
            {**self.desired, "state": "disabled"},
            "disable-historian",
        )
        assert disabled.status_code == 200
        assert self.token_client(new_token).get("/api/v1/users/me/").status_code in {401, 403}
        assert not WorkspaceMember.objects.get(workspace=self.workspace, member_id=user_id).is_active
        assert not ProjectMember.objects.get(project=self.project, member_id=user_id).is_active
        assert IssueComment.objects.filter(id=authored.id, created_by_id=user_id).exists()

        reactivated = self.put_agent(
            admin_client,
            "historian",
            self.desired,
            "reactivate-historian",
        )
        assert reactivated.data["credential"] not in {None, old_token, new_token}
        assert self.token_client(reactivated.data["credential"]).get("/api/v1/users/me/").status_code == 200
        assert WorkspaceMember.objects.get(workspace=self.workspace, member_id=user_id).is_active
        assert ProjectMember.objects.get(project=self.project, member_id=user_id).is_active
        assert IssueComment.objects.filter(id=authored.id, created_by_id=user_id).exists()

    @pytest.mark.django_db(transaction=True)
    def test_simultaneous_retries_create_one_identity_and_return_plaintext_once(self):
        workspace_id = self.workspace.id
        actor_id = self.admin.id

        def apply_once():
            close_old_connections()
            try:
                return WorkspaceAgentMemberships.apply(
                    workspace_id=workspace_id,
                    agent_key="concurrent-agent",
                    desired=self.desired,
                    idempotency_key="same-concurrent-operation",
                    actor=User.objects.get(id=actor_id),
                )
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [future.result() for future in (pool.submit(apply_once), pool.submit(apply_once))]

        assert sum(result["credential"] is not None for result in results) == 1
        assert sum(result["replayed"] is True for result in results) == 1
        user_ids = {result["user_id"] for result in results}
        assert len(user_ids) == 1
        user_id = user_ids.pop()
        assert WorkspaceAgentMembership.objects.filter(agent_key="concurrent-agent").count() == 1
        assert (
            WorkspaceAgentMembershipReceipt.objects.filter(
                membership__agent_key="concurrent-agent",
                idempotency_key="same-concurrent-operation",
            ).count()
            == 1
        )
        assert WorkspaceMember.objects.filter(workspace=self.workspace, member_id=user_id, is_active=True).count() == 1
        assert ProjectMember.objects.filter(project=self.project, member_id=user_id, is_active=True).count() == 1
        assert APIToken.objects.filter(user_id=user_id, is_active=True).count() == 1

    def test_create_and_replay_are_idempotent(self):
        created = self.apply()
        replayed = self.apply()

        assert created["credential"].startswith("plane_api_")
        assert replayed["credential"] is None
        assert replayed["replayed"] is True
        assert created["user_id"] == replayed["user_id"]
        assert WorkspaceAgentMembership.objects.count() == 1
        assert WorkspaceMember.objects.filter(member_id=created["user_id"], is_active=True).count() == 1
        assert ProjectMember.objects.filter(member_id=created["user_id"], is_active=True).count() == 1
        assert APIToken.objects.filter(user_id=created["user_id"], is_active=True).count() == 1

    def test_historical_replay_keeps_receipt_stable_without_undoing_newer_state(self):
        second_project = ProjectFactory(
            workspace=self.workspace,
            name="Replay deleted project",
            identifier="REPLAY",
        )
        desired = {
            **self.desired,
            "project_ids": [str(self.project.id), str(second_project.id)],
        }
        created = self.apply(desired, key="stable-receipt")
        self.apply(
            {**desired, "state": "disabled", "project_ids": []},
            key="membership-drift",
        )
        second_project.delete()

        replayed = self.apply(desired, key="stable-receipt")

        assert replayed == {**created, "credential": None, "replayed": True}
        assert not User.objects.get(id=created["user_id"]).is_active
        assert not WorkspaceMember.objects.get(member_id=created["user_id"]).is_active
        assert not ProjectMember.objects.get(project=self.project, member_id=created["user_id"]).is_active
        assert not ProjectMember.objects.get(
            project_id=second_project.id,
            member_id=created["user_id"],
        ).is_active

    def test_latest_replay_repairs_non_secret_membership_drift(self):
        created = self.apply()
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL plane.agent_lifecycle = 'on'")
            WorkspaceMember.objects.filter(member_id=created["user_id"]).update(is_active=False)
            ProjectMember.objects.filter(member_id=created["user_id"]).update(is_active=False)

        replayed = self.apply()

        assert replayed == {**created, "credential": None, "replayed": True}
        workspace_member = WorkspaceMember.objects.get(member_id=created["user_id"])
        project_member = ProjectMember.objects.get(member_id=created["user_id"])
        assert workspace_member.is_active and workspace_member.role == 15
        assert project_member.is_active and project_member.role == 15

    def test_invalid_project_rolls_back_everything(self):
        with pytest.raises(AgentMembershipError, match="object"):
            self.apply(["not", "an", "object"])

        invalid = {**self.desired, "project_ids": [str(uuid.uuid4())]}
        with pytest.raises(AgentMembershipError, match="belong"):
            self.apply(invalid)

        assert not User.objects.filter(is_bot=True, bot_type="AGENT").exists()
        assert not WorkspaceAgentMembership.objects.exists()

    def test_agent_bot_type_requires_bot_identity(self):
        with pytest.raises(IntegrityError):
            with transaction.atomic():
                UserFactory(is_bot=False, bot_type=BotTypeEnum.AGENT)

    def test_rotate_then_disable_revokes_credentials_and_preserves_user(self):
        created = self.apply()
        rotated = self.apply({**self.desired, "credential_action": "rotate"}, key="operation-2")
        assert rotated["credential"] != created["credential"]
        assert not APIToken.objects.get(token=created["credential"]).is_active

        disabled = self.apply(
            {**self.desired, "state": "disabled", "credential_action": "ensure"},
            key="operation-3",
        )
        assert disabled["user_id"] == created["user_id"]
        assert User.objects.filter(id=created["user_id"], is_active=False).exists()
        assert not WorkspaceMember.objects.get(member_id=created["user_id"]).is_active
        assert not ProjectMember.objects.get(member_id=created["user_id"]).is_active
        assert not APIToken.objects.filter(user_id=created["user_id"], is_active=True).exists()

    def test_requires_exact_role_20_and_rejects_changed_replay(self):
        member = UserFactory(username="ordinary-member")
        WorkspaceMemberFactory(workspace=self.workspace, member=member, role=15)
        with pytest.raises(PermissionError, match="role 20"):
            self.apply(actor=member)

        self.apply()
        with pytest.raises(AgentMembershipConflict):
            self.apply({**self.desired, "display_name": "Different"})

    def test_agent_is_visible_while_workspace_seed_remains_hidden(self):
        active_result = self.apply()
        disabled_result = WorkspaceAgentMemberships.apply(
            workspace_id=self.workspace.id,
            agent_key="disabled-agent",
            desired={
                **self.desired,
                "display_name": "Agent Disabled",
                "state": "disabled",
            },
            idempotency_key="disable-agent",
            actor=self.admin,
        )
        agent = User.objects.get(id=active_result["user_id"])
        disabled = User.objects.get(id=disabled_result["user_id"])
        seed = UserFactory(username="hidden-seed", is_bot=True, bot_type=BotTypeEnum.WORKSPACE_SEED)
        WorkspaceMemberFactory(workspace=self.workspace, member=seed, role=15)
        ProjectMemberFactory(project=self.project, member=self.admin, role=20)
        ProjectMemberFactory(project=self.project, member=seed, role=15)
        suspended = UserFactory(username="suspended-human", is_active=False)
        WorkspaceMemberFactory(workspace=self.workspace, member=suspended, role=15, is_active=False)
        client = APIClient()
        client.force_authenticate(self.admin)

        paths = (
            f"/api/v1/workspaces/{self.workspace.slug}/members/",
            f"/api/v1/workspaces/{self.workspace.slug}/members-lite/",
            f"/api/v1/workspaces/{self.workspace.slug}/projects/{self.project.id}/members/",
            f"/api/v1/workspaces/{self.workspace.slug}/projects/{self.project.id}/project-members-lite/",
            f"/api/workspaces/{self.workspace.slug}/members/",
            f"/api/workspaces/{self.workspace.slug}/projects/{self.project.id}/members/",
            (
                f"/api/workspaces/{self.workspace.slug}/entity-search/"
                f"?query_type=user_mention&project_id={self.project.id}&count=20"
            ),
        )
        for path in paths:
            response = client.get(path)
            assert response.status_code == 200, path
            body = json.dumps(response.data, default=str)
            assert str(agent.id) in body, path
            assert str(disabled.id) not in body, path
            assert str(seed.id) not in body, path

        for path in (
            f"/api/v1/workspaces/{self.workspace.slug}/members/",
            f"/api/workspaces/{self.workspace.slug}/members/",
        ):
            members = client.get(path)
            assert str(suspended.id) in json.dumps(members.data, default=str)

    def test_agent_author_overrides_are_rejected_on_v1_creation_paths(self):
        created = self.apply()
        token = APIToken.objects.get(token=created["credential"])
        client = APIClient()
        client.credentials(HTTP_X_API_KEY=token.token)
        issue = Issue.objects.create(
            name="Authored issue",
            workspace=self.workspace,
            project=self.project,
            state=State.objects.create(
                name="Todo",
                workspace=self.workspace,
                project=self.project,
                group="backlog",
                default=True,
            ),
            created_by=self.admin,
        )
        issue_id = issue.id
        unsupported_paths = (
            f"/api/v1/workspaces/{self.workspace.slug}/projects/{self.project.id}/work-items/",
            f"/api/v1/workspaces/{self.workspace.slug}/projects/{self.project.id}/work-items/{issue_id}/links/",
        )

        for path in unsupported_paths:
            response = client.post(path, {"created_by": str(self.admin.id)}, format="json")
            assert response.status_code == 403

        response = client.post(
            f"/api/v1/workspaces/{self.workspace.slug}/projects/{self.project.id}/work-items/{issue_id}/comments/",
            {"created_by": str(self.admin.id)},
            format="json",
        )
        assert response.status_code == 400
        assert response.data["error"] == "Agent authorship is derived from the authenticated user"

        request = APIRequestFactory().put(
            f"/api/v1/workspaces/{self.workspace.slug}/projects/{self.project.id}/work-items/",
            {
                "external_id": "agent-upsert",
                "external_source": "agent-test",
                "name": "Agent upsert",
                "created_by": str(self.admin.id),
            },
            format="json",
        )
        force_authenticate(request, user=User.objects.get(id=created["user_id"]))
        response = IssueDetailAPIEndpoint.as_view(http_method_names=["put"])(
            request,
            slug=self.workspace.slug,
            project_id=self.project.id,
        )
        assert response.status_code == 400
        assert response.data["error"] == "Agent authorship is derived from the authenticated user"

    def test_runtime_token_rejects_comments_for_an_issue_in_another_project(self):
        other_project = ProjectFactory(
            workspace=self.workspace,
            name="Other project",
            identifier="OTHER",
        )
        other_issue = Issue.objects.create(
            name="Other project issue",
            workspace=self.workspace,
            project=other_project,
            state=State.objects.create(
                name="Other Todo",
                workspace=self.workspace,
                project=other_project,
                group="backlog",
                default=True,
            ),
            created_by=self.admin,
        )
        created = self.apply()
        client = self.token_client(created["credential"])
        url = "/api/v1/workspaces/{}/projects/{}/work-items/{}/comments/".format(
            self.workspace.slug,
            self.project.id,
            other_issue.id,
        )

        response = client.post(url, {"comment_html": "<p>Cross-project</p>"}, format="json")

        assert response.status_code == 403
        assert not IssueComment.objects.filter(issue=other_issue).exists()

    def test_agent_key_fits_activity_log_path_limit(self):
        maximum_key = "a" * MAX_AGENT_KEY_LENGTH
        result = WorkspaceAgentMemberships.apply(
            workspace_id=self.workspace.id,
            agent_key=maximum_key,
            desired=self.desired,
            idempotency_key="maximum-agent-key",
            actor=self.admin,
        )

        assert len(f"/api/v1/workspaces/{'w' * 48}/agent-memberships/{maximum_key}/") == 255
        assert result["credential"].startswith("plane_api_")
        with pytest.raises(AgentMembershipError, match="Agent key is invalid"):
            WorkspaceAgentMemberships.apply(
                workspace_id=self.workspace.id,
                agent_key="a" * (MAX_AGENT_KEY_LENGTH + 1),
                desired=self.desired,
                idempotency_key="too-long-agent-key",
                actor=self.admin,
            )

    def test_lifecycle_token_is_scoped_to_its_workspace_but_users_me_remains_available(self):
        created = self.apply()
        token = APIToken.objects.get(token=created["credential"])
        other_workspace = WorkspaceFactory(owner=self.admin)
        client = APIClient()
        client.credentials(HTTP_X_API_KEY=token.token)

        assert client.get("/api/v1/users/me/").status_code == 200
        assert (
            client.get(f"/api/v1/workspaces/{self.workspace.slug}/projects/{self.project.id}/members/").status_code
            == 200
        )

        user, returned_token = APIKeyAuthentication().validate_api_token(token.token, self.workspace.slug)
        assert str(user.id) == created["user_id"]
        assert returned_token == token.token
        token.last_used = None
        token.save(update_fields=["last_used"])

        with pytest.raises(AuthenticationFailed, match="workspace"):
            APIKeyAuthentication().validate_api_token(token.token, other_workspace.slug)
        token.refresh_from_db()
        assert token.last_used is None

    def test_lifecycle_purpose_is_default_deny_outside_lifecycle_route(self):
        token = APIToken.objects.create(
            user=self.admin,
            label="lifecycle-contract",
            purpose=APIToken.Purpose.AGENT_LIFECYCLE,
            workspace=self.workspace,
        )
        client = self.token_client(token.token)

        assert client.get("/api/v1/users/me/").status_code == 403
        created = self.put_agent(client, "purpose-agent", self.desired, "purpose-create")

        assert created.status_code == 200
        assert created.data["credential"].startswith("plane_api_")

    def test_database_guard_rejects_ordinary_agent_membership_deletes(self):
        install_agent_membership_guards()
        created = self.apply()
        user_id = created["user_id"]

        for model, filters in (
            (WorkspaceMember, {"workspace": self.workspace, "member_id": user_id}),
            (ProjectMember, {"project": self.project, "member_id": user_id}),
        ):
            with pytest.raises(DatabaseError, match="lifecycle-managed"):
                with transaction.atomic():
                    model.objects.filter(**filters).delete()
            assert model.objects.filter(**filters).exists()

    def test_database_guard_allows_lifecycle_and_parent_cascade_deletes(self):
        install_agent_membership_guards()
        lifecycle_project = ProjectFactory(workspace=self.workspace)
        lifecycle = self.apply(
            {
                **self.desired,
                "project_ids": [str(self.project.id), str(lifecycle_project.id)],
            },
            key="lifecycle-delete",
        )
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL plane.agent_lifecycle = 'on'")
            ProjectMember.objects.filter(project=lifecycle_project, member_id=lifecycle["user_id"]).delete(soft=False)
        assert not ProjectMember.objects.filter(project=lifecycle_project, member_id=lifecycle["user_id"]).exists()

        self.project.delete()
        type(self.project).all_objects.filter(id=self.project.id).update(
            deleted_at=timezone.now() - timedelta(days=settings.HARD_DELETE_AFTER_DAYS + 1)
        )
        hard_delete()
        assert not ProjectMember.objects.filter(project_id=self.project.id, member_id=lifecycle["user_id"]).exists()

        workspace = WorkspaceFactory(owner=self.admin)
        WorkspaceMemberFactory(workspace=workspace, member=self.admin, role=20)
        project = ProjectFactory(workspace=workspace)
        workspace_agent = WorkspaceAgentMemberships.apply(
            workspace_id=workspace.id,
            agent_key="workspace-cascade-agent",
            desired={
                **self.desired,
                "project_ids": [str(project.id)],
            },
            idempotency_key="workspace-cascade",
            actor=self.admin,
        )
        workspace.delete()
        soft_delete_related_objects("db", "workspace", workspace.id)
        assert WorkspaceAgentMembership.all_objects.get(id=workspace_agent["membership_id"]).deleted_at is not None
        type(workspace).all_objects.filter(id=workspace.id).update(
            deleted_at=timezone.now() - timedelta(days=settings.HARD_DELETE_AFTER_DAYS + 1)
        )
        hard_delete()
        assert not WorkspaceMember.objects.filter(member_id=workspace_agent["user_id"]).exists()
        assert not ProjectMember.objects.filter(member_id=workspace_agent["user_id"]).exists()

    def test_direct_membership_deletion_remains_guarded(self):
        install_agent_membership_guards()
        created = self.apply(key="recursive-lifecycle")
        project_member = ProjectMember.objects.get(project=self.project, member_id=created["user_id"])

        with pytest.raises(DatabaseError, match="lifecycle-managed"):
            with transaction.atomic():
                soft_delete_related_objects("db", "projectmember", project_member.id)

        assert ProjectMember.all_objects.get(id=project_member.id).deleted_at is None

    def test_token_creation_failure_rolls_back_partial_lifecycle_state(self):
        before = {
            model: model.objects.count()
            for model in (
                User,
                WorkspaceMember,
                ProjectMember,
                APIToken,
                WorkspaceAgentMembership,
                WorkspaceAgentMembershipReceipt,
            )
        }

        with patch(
            "plane.api.services.agent_membership.APIToken.objects.create",
            side_effect=RuntimeError("token creation failed"),
        ):
            with pytest.raises(RuntimeError, match="token creation failed"):
                WorkspaceAgentMemberships.apply(
                    workspace_id=self.workspace.id,
                    agent_key="rollback-agent",
                    desired={**self.desired, "display_name": "Rollback Agent"},
                    idempotency_key="rollback-after-writes",
                    actor=self.admin,
                )

        assert before == {model: model.objects.count() for model in before}
        assert not User.objects.filter(display_name="Rollback Agent").exists()

    def test_webhook_comment_serializer_emits_structured_mention_user_ids(self):
        first, second = uuid.uuid4(), uuid.uuid4()
        comment = SimpleNamespace(
            comment_html=(
                f'<mention-component entity_name="user_mention" entity_identifier="{first}"></mention-component>'
                f'<mention-component entity_name="user_mention" entity_identifier="{second}"></mention-component>'
                f'<mention-component entity_name="user_mention" entity_identifier="{first}"></mention-component>'
            )
        )

        serializer = IssueCommentSerializer()

        assert serializer.get_mentioned_user_ids(comment) == [str(first), str(second)]

    def test_persisted_comment_delivers_structured_mentions_in_signed_webhook(self):
        mentioned = UserFactory(username="mentioned-agent", is_bot=True, bot_type=BotTypeEnum.AGENT)
        issue = Issue.objects.create(
            name="Mention delivery",
            workspace=self.workspace,
            project=self.project,
            state=State.objects.create(
                name="Todo",
                workspace=self.workspace,
                project=self.project,
                group="backlog",
                default=True,
            ),
            created_by=self.admin,
        )
        comment = IssueComment.objects.create(
            workspace=self.workspace,
            project=self.project,
            issue=issue,
            comment_html=(
                f'<p>@mentioned-agent</p><mention-component entity_name="user_mention" '
                f'entity_identifier="{mentioned.id}"></mention-component>'
            ),
            comment_json={},
            created_by=self.admin,
            updated_by=self.admin,
        )
        webhook = Webhook.objects.create(
            workspace=self.workspace,
            url="https://example.com/plane-agent-acceptance",
            issue_comment=True,
            secret_key="acceptance-secret",
            created_by=self.admin,
        )
        delivered = Mock(status_code=200, headers={}, text="ok")

        with patch("plane.bgtasks.webhook_task.pinned_fetch", return_value=delivered) as send:
            webhook_send_task.run(
                webhook_id=str(webhook.id),
                slug=self.workspace.slug,
                event="issue_comment",
                event_data=get_model_data("issue_comment", comment.id),
                action="POST",
                current_site="https://plane.example",
                activity=None,
            )

        payload = send.call_args.kwargs["json"]
        assert payload["webhook_id"] == str(webhook.id)
        assert payload["data"]["id"] == str(comment.id)
        assert payload["data"]["mentioned_user_ids"] == [str(mentioned.id)]
        assert send.call_args.kwargs["headers"]["X-Plane-Signature"]
