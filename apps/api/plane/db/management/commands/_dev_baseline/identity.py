# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Reconcile baseline operators, members, and agents."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from plane.api.services import AgentMembershipError, WorkspaceAgentMemberships
from plane.db.management.commands._dev_baseline.manifest import BaselineError
from plane.db.models import (
    Profile,
    ProjectMember,
    User,
    Workspace,
    WorkspaceAgentMembership,
    WorkspaceMember,
)
from plane.license.models import Instance, InstanceAdmin


# A workspace member who may administer the workspace. The value matches the
# role the product's own workspace-creation path assigns to an owner.
WORKSPACE_ADMIN_ROLE = 20


def _resolve_operator(spec: dict[str, Any]) -> User:
    """Resolve the workspace operator, creating its initial credentials once.

    A fresh stack has no account to sign in with, so the baseline creates the
    declared operator when absent. An existing account is user-owned: replay
    must not reset its password, display name, or active state.
    """

    email = spec.get("email")
    if not email:
        raise BaselineError("operator.email is required")
    email = email.strip().lower()
    user = User.objects.filter(email=email).first()
    if user is not None:
        return user

    # Setup has not run. Creating the account here is what lets one command
    # reach a reviewable state; `_ensure_instance` then completes setup with
    # this same account, matching what the admin client would have produced.
    user = User.objects.create_user(
        email=email,
        username=spec.get("username") or email.split("@")[0],
        password=spec.get("password"),
    )
    user.is_password_autoset = False
    if display_name := spec.get("display_name"):
        user.display_name = display_name
    user.save(update_fields=["display_name", "is_password_autoset"])
    return user


def _ensure_instance(spec: dict[str, Any], operator: User) -> dict[str, Any]:
    """Complete instance setup when it has not been done.

    An instance that has not completed setup never flips its workspace client
    out of the first-run screen, so nothing reconciled here would be reachable
    through the UI. Completing it is therefore part of producing a reviewable
    stack rather than a separate manual step.

    The fields and their order mirror the setup endpoint that normally performs
    this, so an instance completed here is indistinguishable from one completed
    through the admin client.
    """

    instance = Instance.objects.select_for_update().last()
    if instance is None:
        raise BaselineError("no instance row exists; start the stack so the api registers one")
    if instance.is_setup_done:
        return {"instance_setup": "already-done"}

    InstanceAdmin.objects.get_or_create(
        user=operator,
        instance=instance,
        defaults={"role": WORKSPACE_ADMIN_ROLE},
    )
    instance.is_setup_done = True
    if company_name := spec.get("company_name"):
        instance.instance_name = company_name
    instance.save(update_fields=["is_setup_done", "instance_name"])
    return {"instance_setup": "completed"}


def _ensure_workspace(workspace: Workspace, owner: User) -> Workspace:
    if not WorkspaceMember.all_objects.filter(
        workspace=workspace,
        member=owner,
    ).exists():
        WorkspaceMember.objects.create(
            workspace=workspace,
            member=owner,
            role=WORKSPACE_ADMIN_ROLE,
        )
    return workspace


def _ensure_operator_is_onboarded(workspace: Workspace, operator: User) -> list[str]:
    """Initialize navigation state for an operator's newly created workspace.

    This runs only when the baseline creates the workspace. Later reconciles
    preserve onboarding, tour, and last-workspace choices made through the UI.
    """

    profile, _ = Profile.objects.get_or_create(user=operator)
    updates: dict[str, Any] = {}
    if not profile.is_onboarded:
        profile.is_onboarded = True
        updates["is_onboarded"] = True
    if not profile.is_tour_completed:
        profile.is_tour_completed = True
        updates["is_tour_completed"] = True
    if profile.last_workspace_id != workspace.id:
        profile.last_workspace_id = workspace.id
        updates["last_workspace_id"] = str(workspace.id)
    if updates:
        profile.save(update_fields=list(updates))
    return sorted(updates)


def _ensure_members(
    workspace: Workspace,
    spec: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, str]]:
    """Ensure each declared human is a workspace member.

    A human is an ordinary account, so unlike an agent it joins through
    ``WorkspaceMember`` directly and carries a job role and the locales it
    speaks. The locales are recorded on the profile's role text so a reviewer
    can see who can review which language, which is the fact the localisation
    work depends on.

    Returns the report fragment and a key-to-user-id map so work items and
    module leads can name a person rather than a hardcoded address.
    """

    created = 0
    existing = 0
    member_ids: dict[str, str] = {}
    default_password = spec.get("password")
    for entry in spec.get("members") or []:
        key = entry.get("key")
        email = entry.get("email")
        if not key or not email:
            raise BaselineError("each member requires a key and an email")
        email = email.strip().lower()
        user = User.objects.filter(email=email).first()
        was_created = user is None
        if was_created:
            user = User.objects.create_user(
                email=email,
                username=key,
                password=default_password,
                first_name=entry.get("display_name", ""),
            )
            user.is_password_autoset = False
            if display_name := entry.get("display_name"):
                user.display_name = display_name
            user.save(update_fields=["display_name", "is_password_autoset"])
            created += 1
        else:
            existing += 1

        role = int(entry.get("role", WORKSPACE_ADMIN_ROLE))
        if not WorkspaceMember.all_objects.filter(
            workspace=workspace,
            member=user,
        ).exists():
            WorkspaceMember.objects.create(
                workspace=workspace,
                member=user,
                role=role,
            )

        profile, _ = Profile.objects.get_or_create(user=user)
        job_role = entry.get("job_role")
        locales = entry.get("locales") or []
        role_text = " · ".join(
            part
            for part in (
                job_role,
                f"Languages: {', '.join(locales)}" if locales else None,
            )
            if part
        )
        if was_created and role_text:
            profile.role = role_text
            profile.save(update_fields=["role"])
        member_ids[key] = str(user.id)
    return {"members_created": created, "members_existing": existing}, member_ids


def _ensure_roster(
    workspace: Workspace,
    profiles: dict[str, Any],
    actor: User,
    project_ids: list[str],
) -> tuple[dict[str, Any], dict[str, str]]:
    """Create missing agents and add only genuinely new project access.

    Agent membership is owned by the product's lifecycle service. Existing
    identity, activation, and access state is user-owned, so replay does not
    submit the manifest's initial display name or re-activate a deleted project
    membership. When the manifest gains a project, an active agent may gain that
    one missing membership without dropping any other active access.
    """

    created = 0
    replayed = 0
    agent_ids: dict[str, str] = {}
    for slug, spec in sorted(profiles.items()):
        membership = (
            WorkspaceAgentMembership.objects.filter(
                workspace=workspace,
                agent_key=slug,
            )
            .select_related("user")
            .first()
        )
        existing_project_ids: set[str] = set()
        missing_project_ids: set[str] = set()
        if membership is not None:
            user = membership.user
            existing_project_ids = {
                str(project_id)
                for project_id in ProjectMember.objects.filter(
                    workspace=workspace,
                    member=user,
                    is_active=True,
                ).values_list("project_id", flat=True)
            }
            if user.is_active:
                missing_project_ids = {
                    project_id
                    for project_id in project_ids
                    if not ProjectMember.all_objects.filter(
                        workspace=workspace,
                        member=user,
                        project_id=project_id,
                    ).exists()
                }
            if not missing_project_ids:
                agent_ids[slug] = str(user.id)
                replayed += 1
                continue
            display_name = user.display_name or slug
            desired_state = "active"
        else:
            display_name = spec.get("display_name") or slug
            desired_state = "active"
            missing_project_ids = set(project_ids)

        desired = {
            "display_name": display_name,
            "state": desired_state,
            "project_ids": sorted(existing_project_ids | missing_project_ids),
            "credential_action": "ensure",
        }
        request_hash = hashlib.sha256(json.dumps(desired, separators=(",", ":"), sort_keys=True).encode()).hexdigest()[
            :20
        ]
        try:
            result = WorkspaceAgentMemberships.apply(
                workspace_id=workspace.id,
                agent_key=slug,
                desired=desired,
                idempotency_key=f"baseline-{slug}-{request_hash}",
                actor=actor,
            )
        except AgentMembershipError as error:
            raise BaselineError(f"profile {slug!r} could not be applied as an agent: {error}") from error
        agent_ids[slug] = str(result["user_id"])
        if membership is None:
            created += 1
        else:
            replayed += 1
    return {"agents_created": created, "agents_replayed": replayed}, agent_ids
