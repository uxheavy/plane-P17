# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Reconcile project structure declared by a development baseline."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.utils import timezone

from plane.db.management.commands._dev_baseline.manifest import (
    BaselineError,
    _find_active_or_tombstoned,
)
from plane.db.models import (
    DEFAULT_STATES,
    Cycle,
    Label,
    Module,
    Project,
    ProjectMember,
    State,
    User,
    Workspace,
)
from plane.db.models.project import ROLE as PROJECT_ROLE


# The roles the product assigns to project administrators and members.
PROJECT_ADMIN_ROLE = PROJECT_ROLE.ADMIN.value
PROJECT_MEMBER_ROLE = PROJECT_ROLE.MEMBER.value


def _ensure_states(workspace: Workspace, project: Project, actor: User) -> None:
    """Apply the product's own default workflow states to a new project.

    Without this the project has no board columns, which is indistinguishable
    from a broken project to anyone reviewing it.
    """

    for state in DEFAULT_STATES:
        manager = State.triage_objects if state["name"] == "Triage" else State.objects
        manager.get_or_create(
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


def _ensure_project(
    workspace: Workspace,
    spec: dict[str, Any],
    actor: User,
) -> tuple[Project, bool, bool]:
    identifier = str(spec.get("identifier") or "").strip().upper()
    name = spec.get("name")
    if not identifier or not name:
        raise BaselineError("each project requires an identifier and a name")
    project, tombstoned = _find_active_or_tombstoned(
        Project,
        workspace=workspace,
        identifier=identifier,
    )
    if tombstoned:
        return project, False, True
    if project is not None:
        return project, False, False
    name_owner = Project.objects.filter(workspace=workspace, name=name).first()
    if name_owner is not None:
        raise BaselineError(f"project name {name!r} is already owned by identifier {name_owner.identifier!r}")
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
    return project, True, False


def _ensure_project_members(
    workspace: Workspace,
    project: Project,
    spec: dict[str, Any],
    member_ids: dict[str, str],
) -> int:
    """Ensure the human project team declared by the case-owned manifest."""

    created = 0
    for key in spec.get("members") or []:
        member_id = member_ids.get(key)
        if member_id is None:
            raise BaselineError(f"project {project.identifier!r} names undeclared member {key!r}")
        membership_exists = ProjectMember.all_objects.filter(
            workspace=workspace,
            project=project,
            member_id=member_id,
        ).exists()
        if not membership_exists:
            ProjectMember.objects.create(
                workspace=workspace,
                project=project,
                member_id=member_id,
                role=PROJECT_MEMBER_ROLE,
            )
            created += 1
    return created


def _ensure_labels(
    workspace: Workspace,
    spec: dict[str, Any],
    actor: User,
) -> tuple[dict[str, str | None], int]:
    """Ensure the workspace label set the work items reference.

    Labels are workspace-scoped rather than project-scoped, so one set serves
    every client and a work item names a label by key. Returns the key-to-id map
    and how many were created.
    """

    label_ids: dict[str, str | None] = {}
    created = 0
    for entry in spec.get("labels") or []:
        key = entry.get("key")
        name = entry.get("name")
        if not key or not name:
            raise BaselineError("each label requires a key and a name")
        label, tombstoned = _find_active_or_tombstoned(
            Label,
            workspace=workspace,
            project=None,
            name=name,
        )
        if tombstoned:
            label_ids[key] = None
            continue
        if label is None:
            occupied = Label.objects.filter(project=None, name=name).exclude(workspace=workspace).first()
            if occupied is not None:
                raise BaselineError(f"workspace label {name!r} is already owned by another workspace")
            label = Label.objects.create(
                workspace=workspace,
                project=None,
                name=name,
                color=entry.get("color", ""),
                created_by=actor,
            )
            created += 1
        label_ids[key] = str(label.id)
    return label_ids, created


def _ensure_cycles(
    workspace: Workspace,
    project: Project,
    spec: dict[str, Any],
    actor: User,
) -> tuple[dict[int, str | None], int]:
    """Ensure the declared cycles exist, keyed by their manifest index.

    A cycle needs an owner and a date range. The offsets in the manifest are
    relative to the day the baseline is applied, so the stack always looks
    current rather than pinned to the day the manifest was written.

    Returns the index-to-id map and how many cycles were actually created, so a
    re-run reports no work rather than restating what the manifest declares.
    """

    today = timezone.now().date()
    cycle_ids: dict[int, str | None] = {}
    created = 0
    for index, entry in enumerate(spec.get("cycles") or []):
        name = entry.get("name")
        if not name:
            raise BaselineError(f"project {project.identifier!r} has a cycle without a name")
        cycle, tombstoned = _find_active_or_tombstoned(
            Cycle,
            workspace=workspace,
            project=project,
            name=name,
        )
        if tombstoned:
            cycle_ids[index] = None
            continue
        if cycle is None:
            cycle = Cycle.objects.create(
                workspace=workspace,
                project=project,
                name=name,
                owned_by=actor,
                start_date=today + timedelta(days=int(entry.get("start_offset_days", 0))),
                end_date=today + timedelta(days=int(entry.get("end_offset_days", 14))),
                created_by=actor,
            )
            created += 1
        cycle_ids[index] = str(cycle.id)
    return cycle_ids, created


def _ensure_modules(
    workspace: Workspace,
    project: Project,
    spec: dict[str, Any],
    actor: User,
    member_ids: dict[str, str],
) -> tuple[dict[int, str | None], int]:
    """Ensure the declared modules exist, keyed by their manifest index.

    A module carries a lead and a status, and the work items reference it, so a
    module whose lead cannot be resolved is reported rather than created as an
    orphan.
    """

    today = timezone.now().date()
    module_ids: dict[int, str | None] = {}
    created = 0
    for index, entry in enumerate(spec.get("modules") or []):
        name = entry.get("name")
        if not name:
            raise BaselineError(f"project {project.identifier!r} has a module without a name")
        lead_id = member_ids.get(str(entry.get("lead"))) if entry.get("lead") else None
        if entry.get("lead") and lead_id is None:
            raise BaselineError(
                f"project {project.identifier!r} module {name!r} names lead "
                f"{entry.get('lead')!r}, which is not a declared member"
            )
        module, tombstoned = _find_active_or_tombstoned(
            Module,
            workspace=workspace,
            project=project,
            name=name,
        )
        if tombstoned:
            module_ids[index] = None
            continue
        if module is None:
            module = Module.objects.create(
                workspace=workspace,
                project=project,
                name=name,
                status=entry.get("status", "planned"),
                lead_id=lead_id,
                start_date=today + timedelta(days=int(entry.get("start_offset_days", 0))),
                target_date=today + timedelta(days=int(entry.get("target_offset_days", 30))),
                created_by=actor,
            )
            created += 1
        module_ids[index] = str(module.id)
    return module_ids, created
