# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import hashlib
import json
import re
import uuid

from django.db import transaction

from plane.db.models import (
    APIToken,
    BotTypeEnum,
    Project,
    ProjectMember,
    User,
    Workspace,
    WorkspaceAgentMembership,
    WorkspaceAgentMembershipReceipt,
    WorkspaceMember,
)


class AgentMembershipError(ValueError):
    pass


class AgentMembershipConflict(AgentMembershipError):
    pass


class WorkspaceAgentMemberships:
    @staticmethod
    @transaction.atomic
    def apply(*, workspace_id, agent_key, desired, idempotency_key, actor):
        from django.db import connection

        try:
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute("SET LOCAL plane.agent_lifecycle = 'on'")
                return WorkspaceAgentMemberships._apply(
                    workspace_id=workspace_id,
                    agent_key=agent_key,
                    desired=desired,
                    idempotency_key=idempotency_key,
                    actor=actor,
                )
        finally:
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL plane.agent_lifecycle = 'off'")

    @staticmethod
    def _apply(*, workspace_id, agent_key, desired, idempotency_key, actor):
        workspace = Workspace.objects.select_for_update().get(id=workspace_id)
        if not WorkspaceMember.objects.filter(workspace=workspace, member=actor, role=20, is_active=True).exists():
            raise PermissionError("Workspace admin role 20 is required")

        if not isinstance(desired, dict):
            raise AgentMembershipError("Desired state must be an object")
        safe_key = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
        if not isinstance(agent_key, str) or len(agent_key) > 255 or not safe_key.fullmatch(agent_key):
            raise AgentMembershipError("Agent key is invalid")
        if (
            not isinstance(idempotency_key, str)
            or len(idempotency_key) > 255
            or not safe_key.fullmatch(idempotency_key)
        ):
            raise AgentMembershipError("Idempotency key is invalid")

        state = desired.get("state")
        action = desired.get("credential_action", "ensure")
        display_name = str(desired.get("display_name", "")).strip()
        if state not in {"active", "disabled"} or action not in {"ensure", "rotate"}:
            raise AgentMembershipError("Invalid desired state or credential action")
        if not display_name or len(display_name) > 255:
            raise AgentMembershipError("Display name is required and must not exceed 255 characters")

        try:
            project_ids = sorted({str(uuid.UUID(str(value))) for value in desired.get("project_ids", [])})
        except (TypeError, ValueError) as error:
            raise AgentMembershipError("Project IDs must be UUIDs") from error
        normalized = {
            "display_name": display_name,
            "state": state,
            "project_ids": project_ids,
            "credential_action": action,
        }
        request_hash = hashlib.sha256(
            json.dumps(normalized, separators=(",", ":"), sort_keys=True).encode()
        ).hexdigest()

        membership = (
            WorkspaceAgentMembership.objects.select_for_update()
            .filter(workspace=workspace, agent_key=agent_key)
            .first()
        )
        receipt = None
        replayed = False
        if membership:
            receipt = membership.receipts.filter(idempotency_key=idempotency_key).first()
            if receipt:
                if receipt.request_hash != request_hash:
                    raise AgentMembershipConflict("Idempotency key was already used for another request")
                latest_receipt = membership.receipts.order_by("-created_at", "-id").first()
                if latest_receipt.id != receipt.id:
                    return {**receipt.response, "credential": None, "replayed": True}
                replayed = True
            user = membership.user

        projects = list(Project.objects.filter(workspace=workspace, id__in=project_ids))
        if not replayed and len(projects) != len(project_ids):
            raise AgentMembershipError("Every requested project must belong to the workspace")

        if membership is None:
            identity = uuid.uuid5(workspace.id, agent_key)
            user = User.objects.create(
                username=f"agent-{identity}",
                email=f"agent-{identity}@agents.invalid",
                display_name=display_name,
                is_bot=True,
                bot_type=BotTypeEnum.AGENT,
                is_active=True,
            )
            membership = WorkspaceAgentMembership.objects.create(
                workspace=workspace, agent_key=agent_key, user=user, created_by=actor
            )

        user.display_name = display_name
        user.is_bot = True
        user.bot_type = BotTypeEnum.AGENT
        user.is_active = state == "active"
        user.save(update_fields=["display_name", "is_bot", "bot_type", "is_active", "updated_at"])

        workspace_member, _ = WorkspaceMember.objects.get_or_create(
            workspace=workspace, member=user, defaults={"role": 15, "is_active": True}
        )
        workspace_member.role = 15
        workspace_member.is_active = state == "active"
        workspace_member.save(update_fields=["role", "is_active", "updated_at"])

        requested = {str(project.id) for project in projects} if state == "active" else set()
        ProjectMember.objects.filter(workspace=workspace, member=user).exclude(project_id__in=requested).update(
            is_active=False
        )
        for project in projects if state == "active" else ():
            project_member, _ = ProjectMember.objects.get_or_create(
                workspace=workspace, project=project, member=user, defaults={"role": 15}
            )
            if not project_member.is_active or project_member.role != 15:
                project_member.is_active = True
                project_member.role = 15
                project_member.save(update_fields=["is_active", "role", "updated_at"])

        token_label = f"plane-agent-membership:{membership.id}"
        active_tokens = APIToken.objects.filter(user=user, label=token_label, is_active=True)
        credential = None
        if state == "disabled":
            active_tokens.update(is_active=False)
        elif replayed:
            credential = None
        elif action == "rotate":
            active_tokens.update(is_active=False)
            token = APIToken.objects.create(
                user=user,
                workspace=workspace,
                label=token_label,
                user_type=1,
                is_service=True,
                purpose=APIToken.Purpose.AGENT_RUNTIME,
            )
            credential = token.token
        else:
            token = active_tokens.first()
            if token is None:
                token = APIToken.objects.create(
                    user=user,
                    workspace=workspace,
                    label=token_label,
                    user_type=1,
                    is_service=True,
                    purpose=APIToken.Purpose.AGENT_RUNTIME,
                )
                credential = token.token
            active_tokens.exclude(id=token.id).update(is_active=False)

        response = (
            receipt.response
            if replayed
            else {
                "membership_id": str(membership.id),
                "user_id": str(user.id),
                "workspace_id": str(workspace.id),
                "state": state,
                "project_ids": project_ids,
            }
        )
        if not replayed:
            WorkspaceAgentMembershipReceipt.objects.create(
                membership=membership,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
                created_by=actor,
            )
        return {**response, "credential": credential, "replayed": replayed}
