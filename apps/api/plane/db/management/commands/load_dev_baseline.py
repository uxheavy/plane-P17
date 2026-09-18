# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Reconcile a tracked baseline manifest into this database.

The manifest is case-owned data; this command is the neutral mechanism that
applies it and knows nothing about which workspace it is applying. It exists so
a running stack has something real to inspect without anyone seeding through the
UI, and so an acceptance run starts from persisted state rather than an empty
database.

The command is ensure-only and idempotent. It creates what the manifest declares
and leaves everything else alone: re-running it converges rather than
accumulating duplicates, and state a person changed through the UI while
reviewing survives. It never deletes, and it never resets. Removal stays an
explicit action outside this command.

It dispatches through Plane's own code paths rather than writing rows directly,
so every workspace, project, membership, and identity invariant is enforced by
the same code the product uses. Agent membership is delegated to
``WorkspaceAgentMemberships``, which owns the lifecycle contract a database
trigger enforces; assembling those rows here would duplicate it. It deliberately
does not use the REST API, which would require a working admin session before
the baseline could be applied.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from plane.api.services import (
    AgentMembershipError,
    WorkspaceAgentMemberships,
)
from plane.db.models import (
    DEFAULT_STATES,
    Issue,
    IssueAssignee,
    IssueSequence,
    Project,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
)

# A workspace member who may administer the workspace. The value matches the
# role the product's own workspace-creation path assigns to an owner.
WORKSPACE_ADMIN_ROLE = 20

# The role the product assigns to a project creator and project lead.
PROJECT_ADMIN_ROLE = 20

MANIFEST_FILES = {
    "operator": "operator.json",
    "workspace": "workspace.json",
    "roster": "roster.json",
    "projects": "projects.json",
}


class BaselineError(CommandError):
    """A manifest is missing, malformed, or internally inconsistent."""


def _read(manifest_dir: Path, name: str) -> dict[str, Any]:
    path = manifest_dir / name
    if not path.is_file():
        raise BaselineError(f"baseline manifest is missing: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise BaselineError(f"baseline manifest is unreadable: {path}: {error}")
    if not isinstance(payload, dict):
        raise BaselineError(f"baseline manifest must be a JSON object: {path}")
    return payload


def _load(manifest_dir: Path) -> dict[str, Any]:
    if not manifest_dir.is_dir():
        raise BaselineError(f"baseline directory is missing: {manifest_dir}")
    return {key: _read(manifest_dir, name) for key, name in MANIFEST_FILES.items()}


def _ensure_operator(spec: dict[str, Any]) -> tuple[User, bool]:
    """Ensure the operator account exists, without changing an existing one."""

    email = spec.get("email")
    if not email:
        raise BaselineError("operator.email is required")
    user = User.objects.filter(email=email).first()
    if user is not None:
        return user, False
    username = spec.get("username") or email.split("@")[0]
    if User.objects.filter(username=username).exists():
        raise BaselineError(f"username {username!r} is taken by a different account than {email!r}")
    user = User.objects.create_user(
        email=email,
        username=username,
        password=spec.get("password"),
    )
    if display_name := spec.get("display_name"):
        user.display_name = display_name
        user.save(update_fields=["display_name"])
    return user, True


def _ensure_workspace(workspace: Workspace, owner: User) -> Workspace:
    workspace.owner = owner
    workspace.save(update_fields=["owner"])
    WorkspaceMember.objects.get_or_create(
        workspace=workspace,
        member=owner,
        defaults={"role": WORKSPACE_ADMIN_ROLE},
    )
    return workspace


def _ensure_roster(
    workspace: Workspace,
    profiles: dict[str, Any],
    actor: User,
    project_ids: list[str],
) -> tuple[dict[str, Any], dict[str, str]]:
    """Ensure one lifecycle-managed agent per profile.

    Agent membership is owned by the product's own service rather than by this
    command. A database trigger rejects a bot workspace membership created any
    other way: agent rows require the lifecycle opt-in, an owning
    ``WorkspaceAgentMembership``, and the agent role. Assembling those rows here
    would duplicate a contract the schema already enforces, so this delegates
    and lets the service's own idempotency receipts make a re-run a replay.

    Returns the report fragment and each profile's resolved user id.
    """

    created = 0
    replayed = 0
    agent_ids: dict[str, str] = {}
    for slug, spec in sorted(profiles.items()):
        display_name = spec.get("display_name") or slug
        try:
            result = WorkspaceAgentMemberships.apply(
                workspace_id=workspace.id,
                agent_key=slug,
                desired={
                    "display_name": display_name,
                    "state": "active",
                    "project_ids": project_ids,
                    "credential_action": "ensure",
                },
                # Derived from the agent key so a re-run replays the same
                # request instead of conflicting with the first one.
                idempotency_key=f"baseline-{slug}",
                actor=actor,
            )
        except AgentMembershipError as error:
            raise BaselineError(f"profile {slug!r} could not be applied as an agent: {error}") from error
        agent_ids[slug] = str(result["user_id"])
        if result.get("replayed"):
            replayed += 1
        else:
            created += 1
    return {"agents_created": created, "agents_replayed": replayed}, agent_ids


def _ensure_states(workspace: Workspace, project: Project, actor: User) -> None:
    """Apply the product's own default workflow states to a new project.

    Without this the project has no board columns, which is indistinguishable
    from a broken project to anyone reviewing it.
    """

    for state in DEFAULT_STATES:
        State.objects.get_or_create(
            project=project,
            workspace=workspace,
            name=state["name"],
            defaults={
                "color": state["color"],
                "sequence": state["sequence"],
                "group": state["group"],
                "default": state.get("default", False),
                "created_by": actor,
            },
        )


def _ensure_project(workspace: Workspace, spec: dict[str, Any], actor: User) -> tuple[Project, bool]:
    identifier = spec.get("identifier")
    name = spec.get("name")
    if not identifier or not name:
        raise BaselineError("each project requires an identifier and a name")
    project = Project.objects.filter(workspace=workspace, identifier=identifier).first()
    if project is not None:
        return project, False
    views = spec.get("views") or {}
    project = Project.objects.create(
        workspace=workspace,
        name=name,
        identifier=identifier,
        description=spec.get("description") or "",
        network=spec.get("network", 2),
        created_by=actor,
        module_view=views.get("module_view", False),
        cycle_view=views.get("cycle_view", False),
        issue_views_view=views.get("issue_views_view", False),
        page_view=views.get("page_view", True),
        intake_view=views.get("intake_view", False),
        timezone=workspace.timezone,
    )
    ProjectMember.objects.create(project=project, workspace=workspace, member=actor, role=PROJECT_ADMIN_ROLE)
    _ensure_states(workspace, project, actor)
    return project, True


def _ensure_work_items(
    workspace: Workspace,
    project: Project,
    spec: dict[str, Any],
    actor: User,
    agent_ids: dict[str, str],
) -> tuple[int, int, int]:
    """Ensure the declared work items exist in the declared state.

    Assignment is resolved from the agent ids the roster applied, so a work item
    names an assignee that exists rather than one that would be created later.
    Returns created, existing, and assigned counts.
    """

    created = 0
    existing = 0
    assigned = 0
    states = {state.name: state for state in State.objects.filter(project=project, workspace=workspace)}
    for item in spec.get("work_items") or []:
        name = item.get("name")
        if not name:
            raise BaselineError(f"project {project.identifier!r} has a work item without a name")
        state_name = item.get("state") or "Backlog"
        state = states.get(state_name)
        if state is None:
            raise BaselineError(f"project {project.identifier!r} declares unknown state {state_name!r}")
        assignee_key = item.get("assignee")
        assignee_id = agent_ids.get(str(assignee_key)) if assignee_key else None
        if assignee_key and assignee_id is None:
            raise BaselineError(
                f"project {project.identifier!r} assigns {assignee_key!r}, which is not a declared profile"
            )

        issue = Issue.objects.filter(workspace=workspace, project=project, name=name).first()
        if issue is None:
            sequence = IssueSequence.objects.filter(project=project).first()
            if sequence is None:
                sequence = IssueSequence.objects.create(project=project, workspace=workspace, created_by=actor)
            sequence.sequence += 1
            sequence.save(update_fields=["sequence"])
            issue = Issue.objects.create(
                workspace=workspace,
                project=project,
                name=name,
                state=state,
                created_by=actor,
                sequence_id=sequence.sequence,
            )
            created += 1
        else:
            existing += 1

        # Assignment goes through the explicit join model. Passing
        # ``assignees=[...]`` to ``create`` would be silently ignored because
        # the relation declares a ``through`` model, and the work item would
        # report as created while having no assignee.
        if assignee_id is not None:
            _, was_assigned = IssueAssignee.objects.get_or_create(
                issue=issue,
                assignee_id=assignee_id,
                project=project,
                workspace=workspace,
                defaults={"created_by": actor},
            )
            assigned += int(was_assigned)
    return created, existing, assigned


class Command(BaseCommand):
    help = "Reconcile a tracked baseline manifest into this database"

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "manifest_dir",
            type=Path,
            help="directory holding operator, workspace, roster, and project manifests",
        )

    def handle(self, *args: Any, **options: Any) -> str | None:
        manifest_dir: Path = options["manifest_dir"]
        manifest = _load(manifest_dir)

        workspace_spec = manifest["workspace"].get("workspace") or {}
        slug = workspace_spec.get("slug")
        if not slug:
            raise BaselineError("workspace.slug is required")

        report: dict[str, Any] = {"operation": "reconcile", "workspace": slug}

        with transaction.atomic():
            operator, operator_created = _ensure_operator(manifest["operator"].get("operator") or {})
            if not Workspace.objects.filter(slug=slug).exists():
                Workspace.objects.create(
                    slug=slug,
                    name=workspace_spec.get("name") or slug,
                    owner=operator,
                    organization_size=workspace_spec.get("organization_size"),
                )
                report["workspace_created"] = True
            else:
                report["workspace_created"] = False
            workspace = Workspace.objects.get(slug=slug)
            _ensure_workspace(workspace, operator)
            report["operator_created"] = operator_created

            profiles = manifest["roster"].get("profiles") or {}
            if not profiles:
                raise BaselineError("roster.profiles must declare at least one profile")

            projects_created = 0
            projects_existing = 0
            projects: list[tuple[Project, dict[str, Any]]] = []
            project_ids: list[str] = []
            for spec in manifest["projects"].get("projects") or []:
                project, was_created = _ensure_project(workspace, spec, operator)
                projects.append((project, spec))
                project_ids.append(str(project.id))
                projects_created += int(was_created)
                projects_existing += int(not was_created)

            roster_report, agent_ids = _ensure_roster(workspace, profiles, operator, project_ids)
            report.update(roster_report)

            # Work items come last because an assignee must resolve to an agent
            # the roster has already applied.
            items_created = 0
            items_existing = 0
            assignments_created = 0
            for project, spec in projects:
                made, present, assigned = _ensure_work_items(workspace, project, spec, operator, agent_ids)
                items_created += made
                items_existing += present
                assignments_created += assigned
            report["projects_created"] = projects_created
            report["projects_existing"] = projects_existing
            report["work_items_created"] = items_created
            report["work_items_existing"] = items_existing
            report["assignments_created"] = assignments_created

        report["status"] = "passed"
        self.stdout.write(json.dumps(report, indent=2, sort_keys=True))
        return None
