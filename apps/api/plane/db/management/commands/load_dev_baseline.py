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

import hashlib
import json
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from crum import impersonate

from plane.api.services import (
    AgentMembershipError,
    WorkspaceAgentMemberships,
)
from plane.db.models import (
    DEFAULT_STATES,
    Channel,
    Cycle,
    CycleIssue,
    Document,
    DocumentProject,
    Intake,
    IntakeIssue,
    Issue,
    IssueAssignee,
    IssueLabel,
    Label,
    Message,
    Module,
    ModuleIssue,
    Page,
    Profile,
    Project,
    ProjectMember,
    State,
    User,
    WorkMap,
    WorkMapBinding,
    Workspace,
    WorkspaceAgentMembership,
    WorkspaceMember,
)
from plane.db.models.project import ROLE as PROJECT_ROLE
from plane.license.models import Instance, InstanceAdmin

# A workspace member who may administer the workspace. The value matches the
# role the product's own workspace-creation path assigns to an owner.
WORKSPACE_ADMIN_ROLE = 20

# The roles the product assigns to project administrators and members.
PROJECT_ADMIN_ROLE = PROJECT_ROLE.ADMIN.value
PROJECT_MEMBER_ROLE = PROJECT_ROLE.MEMBER.value

MANIFEST_FILES = {
    "operator": "operator.json",
    "workspace": "workspace.json",
    "members": "members.json",
    "roster": "roster.json",
    "projects": "projects.json",
}


class BaselineError(CommandError):
    """A manifest is missing, malformed, or internally inconsistent."""


def _find_active_or_tombstoned(model: Any, **lookup: Any) -> tuple[Any | None, bool]:
    """Return an active match first, or its tombstone without reviving it."""

    active = model.objects.filter(**lookup).order_by("created_at", "id").first()
    if active is not None:
        return active, False
    tombstone = model.all_objects.filter(**lookup, deleted_at__isnull=False).order_by("-deleted_at", "id").first()
    return tombstone, tombstone is not None


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


def _ensure_pages(
    workspace: Workspace,
    project: Project,
    spec: dict[str, Any],
    actor: User,
) -> int:
    """Ensure the declared brief pages exist and are linked to the project.

    ``Page`` inherits ``Document`` through a one-to-one primary key, so a single
    ``Page`` create writes both rows. Creating the parent ``Document`` first as
    well inserts the same primary key twice, which fails as a duplicate key. The
    link row is separate, and it is what makes the page visible in the project.
    """

    created = 0
    for entry in spec.get("pages") or []:
        name = entry.get("name")
        if not name:
            raise BaselineError(f"project {project.identifier!r} has a page without a name")
        page, tombstoned = _find_active_or_tombstoned(
            Page,
            workspace=workspace,
            name=name,
        )
        if tombstoned:
            continue
        if page is None:
            page = Page.objects.create(
                workspace=workspace,
                kind=Document.Kind.PAGE,
                name=name,
                owned_by=actor,
                created_by=actor,
                description_html=entry.get("body", "<p></p>"),
            )
            created += 1
        if not DocumentProject.all_objects.filter(
            document_id=page.id,
            project=project,
            workspace=workspace,
        ).exists():
            DocumentProject.objects.create(
                document_id=page.id,
                project=project,
                workspace=workspace,
                created_by=actor,
            )
    return created


def _scene_document(
    title: str,
    lanes: list[tuple[str, list[str]]],
    bindings: dict[str, str] | None = None,
) -> bytes:
    """Build an Excalidraw-compatible work map scene.

    A work map with empty scene bytes opens as a blank canvas, which a reviewer
    cannot distinguish from a broken canvas. The scene is the same shape
    Excalidraw persists: a list of elements and a files map. Frames carry the
    swimlanes and bound text carries the labels, so a project's work is legible
    the moment the map is opened.

    ``bindings`` maps a card label to a node key. A bound card becomes a carrier:
    a rectangle whose ``customData`` is exactly ``{"nodeKey": ...}``. The binding
    contract refuses any other custom data or shape, and refuses a carrier whose
    node key has no live binding, so the two are written together or not at all.
    """

    bindings = bindings or {}
    elements: list[dict[str, Any]] = []
    lane_width = 340
    lane_gap = 40
    card_height = 64
    card_gap = 18
    top = 120

    elements.append(
        {
            "id": "title",
            "type": "text",
            "x": 0,
            "y": 0,
            "width": 620,
            "height": 40,
            "angle": 0,
            "strokeColor": "#1e1e1e",
            "backgroundColor": "transparent",
            "fillStyle": "solid",
            "strokeWidth": 2,
            "strokeStyle": "solid",
            "roughness": 0,
            "opacity": 100,
            "groupIds": [],
            "frameId": None,
            "roundness": None,
            "seed": 1,
            "version": 1,
            "versionNonce": 1,
            "isDeleted": False,
            "boundElements": None,
            "updated": 1,
            "link": None,
            "locked": False,
            "fontSize": 28,
            "fontFamily": 1,
            "text": title,
            "textAlign": "left",
            "verticalAlign": "top",
            "containerId": None,
            "originalText": title,
            "lineHeight": 1.25,
            "baseline": 28,
        }
    )

    for lane_index, (lane_name, cards) in enumerate(lanes):
        lane_x = lane_index * (lane_width + lane_gap)
        frame_id = f"lane-{lane_index}"
        frame_height = top + len(cards) * (card_height + card_gap) + 20
        elements.append(
            {
                "id": frame_id,
                "type": "frame",
                "x": lane_x,
                "y": top - 40,
                "width": lane_width,
                "height": frame_height,
                "angle": 0,
                "strokeColor": "#c7c7c7",
                "backgroundColor": "transparent",
                "fillStyle": "solid",
                "strokeWidth": 1,
                "strokeStyle": "solid",
                "roughness": 0,
                "opacity": 100,
                "groupIds": [],
                "frameId": None,
                "roundness": None,
                "seed": 100 + lane_index,
                "version": 1,
                "versionNonce": 100 + lane_index,
                "isDeleted": False,
                "boundElements": None,
                "updated": 1,
                "link": None,
                "locked": False,
                "name": lane_name,
            }
        )
        # The frame label is its own text element, which is how Excalidraw
        # renders a frame name on the canvas rather than only in the sidebar.
        elements.append(
            {
                "id": f"{frame_id}-label",
                "type": "text",
                "x": lane_x + 8,
                "y": top - 32,
                "width": lane_width - 16,
                "height": 24,
                "angle": 0,
                "strokeColor": "#495057",
                "backgroundColor": "transparent",
                "fillStyle": "solid",
                "strokeWidth": 1,
                "strokeStyle": "solid",
                "roughness": 0,
                "opacity": 100,
                "groupIds": [],
                "frameId": frame_id,
                "roundness": None,
                "seed": 200 + lane_index,
                "version": 1,
                "versionNonce": 200 + lane_index,
                "isDeleted": False,
                "boundElements": None,
                "updated": 1,
                "link": None,
                "locked": False,
                "fontSize": 18,
                "fontFamily": 1,
                "text": lane_name,
                "textAlign": "left",
                "verticalAlign": "top",
                "containerId": None,
                "originalText": lane_name,
                "lineHeight": 1.25,
                "baseline": 18,
            }
        )
        for card_index, card in enumerate(cards):
            card_y = top + card_index * (card_height + card_gap)
            rect_id = f"{frame_id}-card-{card_index}"
            text_id = f"{rect_id}-text"
            node_key = bindings.get(card)
            rectangle: dict[str, Any] = {
                "id": rect_id,
                "type": "rectangle",
                "x": lane_x + 12,
                "y": card_y,
                "width": lane_width - 24,
                "height": card_height,
                "angle": 0,
                "strokeColor": "#1971c2",
                "backgroundColor": "#e7f5ff",
                "fillStyle": "solid",
                "strokeWidth": 1,
                "strokeStyle": "solid",
                "roughness": 0,
                "opacity": 100,
                "groupIds": [],
                "frameId": frame_id,
                "roundness": {"type": 3},
                "seed": 1000 + lane_index * 100 + card_index,
                "version": 1,
                "versionNonce": 1000 + lane_index * 100 + card_index,
                "isDeleted": False,
                "boundElements": [{"id": text_id, "type": "text"}],
                "updated": 1,
                "link": None,
                "locked": False,
            }
            if node_key is not None:
                # A carrier's customData holds the node key and nothing else, and
                # it must not carry a link. This is the shape the binding
                # contract accepts for a Company Runner carrier.
                rectangle["customData"] = {"nodeKey": node_key}
            elements.append(rectangle)
            elements.append(
                {
                    "id": text_id,
                    "type": "text",
                    "x": lane_x + 24,
                    "y": card_y + 12,
                    "width": lane_width - 48,
                    "height": 40,
                    "angle": 0,
                    "strokeColor": "#1e1e1e",
                    "backgroundColor": "transparent",
                    "fillStyle": "solid",
                    "strokeWidth": 1,
                    "strokeStyle": "solid",
                    "roughness": 0,
                    "opacity": 100,
                    "groupIds": [],
                    "frameId": frame_id,
                    "roundness": None,
                    "seed": 2000 + lane_index * 100 + card_index,
                    "version": 1,
                    "versionNonce": 2000 + lane_index * 100 + card_index,
                    "isDeleted": False,
                    "boundElements": None,
                    "updated": 1,
                    "link": None,
                    "locked": False,
                    "fontSize": 14,
                    "fontFamily": 1,
                    "text": card,
                    "textAlign": "left",
                    "verticalAlign": "top",
                    "containerId": rect_id,
                    "originalText": card,
                    "lineHeight": 1.25,
                    "baseline": 14,
                    "autoResize": True,
                }
            )

    return json.dumps(
        {
            "type": "excalidraw",
            "version": 2,
            "source": "company-runner-baseline",
            "elements": elements,
            "appState": {"gridSize": None, "viewBackgroundColor": "#ffffff"},
            "files": {},
        }
    ).encode("utf-8")


def _ensure_work_maps(
    workspace: Workspace,
    project: Project,
    spec: dict[str, Any],
    actor: User,
) -> tuple[int, int]:
    """Create missing work maps with their initial scene and source bindings.

    Existing maps are user-owned and never rewritten by baseline replay. A new
    work map is a ``Document`` of kind ``work-map`` plus a ``WorkMap`` row and
    a project link, exactly as the create endpoint builds it. ``WorkMap`` shares
    the document's primary key, so the document is created first and the row
    references it rather than the reverse.

    A map whose cards are unbound is a picture of work rather than a view onto
    it. Each bound card gets a carrier element in the scene and a binding row to
    the Plane object it represents, so opening the map reaches the real work
    item, module, or cycle.

    Returns how many work maps and how many bindings were created.
    """

    created = 0
    bindings_created = 0
    for entry in spec.get("work_maps") or []:
        name = entry.get("name")
        if not name:
            raise BaselineError(f"project {project.identifier!r} has a work map without a name")
        document_links = DocumentProject.all_objects.filter(
            workspace=workspace,
            project=project,
            document__workspace=workspace,
            document__kind=Document.Kind.WORK_MAP,
            document__name=name,
        )
        if document_links.exists():
            # Baseline ownership ends after initial creation. Active maps keep
            # user edits; soft-deleted maps and links remain deleted.
            continue

        targets = _resolve_bindings(workspace, project, entry)
        document = Document.objects.create(
            kind=Document.Kind.WORK_MAP,
            workspace=workspace,
            owned_by=actor,
            created_by=actor,
            name=name,
            access=entry.get("access", Document.PUBLIC_ACCESS),
        )
        created += 1
        card_keys = {
            card: str(uuid.uuid5(document.id, card))
            for lane in entry.get("lanes") or []
            for value in lane.get("cards") or []
            if (card := str(value)) in targets
        }
        lanes = [
            (str(lane.get("name") or ""), [str(card) for card in lane.get("cards") or []])
            for lane in entry.get("lanes") or []
        ]
        work_map = WorkMap.objects.create(
            document=document,
            scene_binary=_scene_document(name, lanes, card_keys),
            generation=1,
        )
        for card, node_key in card_keys.items():
            source_kind, source_id = targets[card]
            WorkMapBinding.objects.create(
                work_map=work_map,
                node_key=node_key,
                source_kind=source_kind,
                source_id=source_id,
                created_by=actor,
            )
            bindings_created += 1
        DocumentProject.objects.get_or_create(
            document_id=document.id,
            project=project,
            workspace=workspace,
            defaults={"created_by": actor},
        )
    return created, bindings_created


def _resolve_bindings(
    workspace: Workspace,
    project: Project,
    work_map: dict[str, Any],
) -> dict[str, tuple[str, str]]:
    """Resolve each declared binding to its project-scoped Plane object.

    An unresolvable target fails here, before the scene is written, rather than
    producing a carrier whose binding is missing.
    """

    target_ids: dict[str, tuple[str, str]] = {}
    resolvers: dict[str, Any] = {
        WorkMapBinding.SourceKind.WORK_ITEM: Issue,
        WorkMapBinding.SourceKind.MODULE: Module,
        WorkMapBinding.SourceKind.CYCLE: Cycle,
    }
    for binding in work_map.get("bindings") or []:
        card = binding.get("card")
        source_kind = binding.get("source_kind")
        source_name = binding.get("source_name")
        if not card or not source_kind or not source_name:
            raise BaselineError(
                f"work map {work_map.get('name')!r} has a binding missing a card, source_kind, or source_name"
            )
        model = resolvers.get(source_kind)
        if model is None:
            raise BaselineError(
                f"work map {work_map.get('name')!r} binds card {card!r} to unsupported source_kind {source_kind!r}"
            )
        target, tombstoned = _find_active_or_tombstoned(
            model,
            workspace=workspace,
            project=project,
            name=source_name,
        )
        if tombstoned:
            continue
        if target is None:
            raise BaselineError(
                f"work map {work_map.get('name')!r} binds card {card!r} to "
                f"{source_kind} {source_name!r}, which does not exist in this project"
            )
        target_ids[str(card)] = (source_kind, str(target.id))
    return target_ids


def _ensure_conversations(
    workspace: Workspace,
    spec: dict[str, Any],
    actor: User,
) -> tuple[int, int]:
    """Ensure the declared channels, their threads, and their messages exist.

    A conversation is a ``Channel`` holding messages, with a reply carried as a
    message whose ``parent`` is the message it answers. A message is addressed
    by its ``client_id`` rather than its generated primary key, so a reply can
    name its parent in the manifest.

    Returns how many channels and how many messages were created.
    """

    channels_created = 0
    messages_created = 0
    for entry in spec.get("channels") or []:
        name = entry.get("name")
        if not name:
            raise BaselineError("each channel requires a name")
        channel, tombstoned = _find_active_or_tombstoned(
            Channel,
            workspace=workspace,
            name=name,
        )
        if tombstoned:
            continue
        if channel is None:
            channel = Channel.objects.create(
                workspace=workspace,
                name=name,
                created_by=actor,
            )
            channels_created += 1
        for message in entry.get("messages") or []:
            body = message.get("content")
            client_id = message.get("client_id")
            if not body or not client_id:
                raise BaselineError(f"channel {name!r} has a message without content and client_id")
            existing, _ = _find_active_or_tombstoned(
                Message,
                channel=channel,
                client_id=client_id,
            )
            if existing is not None:
                continue
            parent = None
            if (parent_id := message.get("parent")) is not None:
                parent, parent_tombstoned = _find_active_or_tombstoned(
                    Message,
                    channel=channel,
                    client_id=parent_id,
                )
                if parent_tombstoned:
                    continue
                if parent is None:
                    raise BaselineError(f"channel {name!r} has a reply to unknown message {parent_id!r}")
            Message.objects.create(
                channel=channel,
                client_id=client_id,
                content=body,
                parent=parent,
                created_by=actor,
            )
            messages_created += 1
    return channels_created, messages_created


def _ensure_intake(
    workspace: Workspace,
    project: Project,
    spec: dict[str, Any],
    actor: User,
) -> tuple[int, int]:
    """Ensure the project's intake box and its submitted items exist.

    An intake item is an ``Issue`` plus an ``IntakeIssue`` row carrying the
    triage status, so the work item is created through the same path as any
    other and is then enrolled in the intake.

    Returns how many intake boxes and how many submitted items were created.
    """

    intake_spec = spec.get("intake")
    if not intake_spec:
        return 0, 0
    intakes_created = 0
    items_created = 0
    # State has specialized managers rather than SoftDeleteModel's `all_objects`:
    # `objects` excludes triage, while `all_state_objects` includes tombstones.
    triage_state = State.triage_objects.filter(
        project=project,
        workspace=workspace,
    ).first()
    if triage_state is None:
        triage_tombstoned = State.all_state_objects.filter(
            project=project,
            workspace=workspace,
            name="Triage",
            deleted_at__isnull=False,
        ).exists()
        if triage_tombstoned:
            return 0, 0
        raise BaselineError(f"project {project.identifier!r} has no triage state")

    intake, tombstoned = _find_active_or_tombstoned(
        Intake,
        workspace=workspace,
        project=project,
        name=intake_spec.get("name") or "Intake",
    )
    if tombstoned:
        return 0, 0
    if intake is None:
        intake = Intake.objects.create(
            workspace=workspace,
            project=project,
            name=intake_spec.get("name") or "Intake",
            is_default=True,
            created_by=actor,
        )
        intakes_created += 1
    for item in intake_spec.get("items") or []:
        name = item.get("name")
        if not name:
            raise BaselineError(f"project {project.identifier!r} has an intake item without a name")
        issue, issue_tombstoned = _find_active_or_tombstoned(
            Issue,
            workspace=workspace,
            project=project,
            name=name,
        )
        if issue_tombstoned:
            continue
        if issue is None:
            # A submitted item lands in Triage, which is the state the product
            # routes an unaccepted intake submission to. Issue.save owns the
            # project sequence and its transaction-level lock.
            issue = Issue.objects.create(
                workspace=workspace,
                project=project,
                name=name,
                state=triage_state,
                priority=item.get("priority", "none"),
                created_by=actor,
            )
            items_created += 1
        intake_issue, _ = _find_active_or_tombstoned(
            IntakeIssue,
            workspace=workspace,
            project=project,
            intake=intake,
            issue=issue,
        )
        if intake_issue is None:
            IntakeIssue.objects.create(
                workspace=workspace,
                project=project,
                intake=intake,
                issue=issue,
                status=item.get("status", -2),
                source="IN_APP",
                source_email=item.get("source_email"),
                created_by=actor,
            )
    return intakes_created, items_created


def _ensure_work_items(
    workspace: Workspace,
    project: Project,
    spec: dict[str, Any],
    actor: User,
    assignee_ids: dict[str, str],
    label_ids: dict[str, str | None],
    cycle_ids: dict[int, str | None],
    module_ids: dict[int, str | None],
) -> tuple[int, int, int, int]:
    """Ensure the declared work items exist in the declared state.

    Assignment is resolved from the agent ids the roster applied, so a work item
    names an assignee that exists rather than one that would be created later.
    Returns created, existing, and assigned counts.
    """

    created = 0
    existing = 0
    assigned = 0
    labelled = 0
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
        assignee_id = assignee_ids.get(str(assignee_key)) if assignee_key else None
        if assignee_key and assignee_id is None:
            raise BaselineError(
                f"project {project.identifier!r} assigns {assignee_key!r}, which is "
                "neither a declared member nor a declared profile"
            )

        issue, issue_tombstoned = _find_active_or_tombstoned(
            Issue,
            workspace=workspace,
            project=project,
            name=name,
        )
        if issue_tombstoned:
            existing += 1
            continue
        if issue is None:
            # Issue.save owns the project sequence and its transaction-level lock.
            issue = Issue.objects.create(
                workspace=workspace,
                project=project,
                name=name,
                state=state,
                priority=item.get("priority", "none"),
                created_by=actor,
            )
            created += 1
        else:
            existing += 1

        # Assignment goes through the explicit join model. Passing
        # ``assignees=[...]`` to ``create`` would be silently ignored because
        # the relation declares a ``through`` model, and the work item would
        # report as created while having no assignee.
        if assignee_id is not None:
            assignment, _ = _find_active_or_tombstoned(
                IssueAssignee,
                issue=issue,
                assignee_id=assignee_id,
                project=project,
                workspace=workspace,
            )
            if assignment is None:
                IssueAssignee.objects.create(
                    issue=issue,
                    assignee_id=assignee_id,
                    project=project,
                    workspace=workspace,
                    created_by=actor,
                )
                assigned += 1

        # Labels are a through relation for the same reason as assignees.
        for label_key in item.get("labels") or []:
            key = str(label_key)
            if key not in label_ids:
                raise BaselineError(
                    f"project {project.identifier!r} work item {name!r} names label "
                    f"{label_key!r}, which is not declared in the workspace label set"
                )
            label_id = label_ids[key]
            if label_id is None:
                continue
            issue_label, _ = _find_active_or_tombstoned(
                IssueLabel,
                issue=issue,
                label_id=label_id,
                project=project,
                workspace=workspace,
            )
            if issue_label is None:
                IssueLabel.objects.create(
                    issue=issue,
                    label_id=label_id,
                    project=project,
                    workspace=workspace,
                    created_by=actor,
                )
                labelled += 1

        # Cycle and module membership are through rows as well. A work item in a
        # cycle is what makes the cycle view non-empty.
        if (index := item.get("cycle")) is not None:
            index = int(index)
            if index not in cycle_ids:
                raise BaselineError(
                    f"project {project.identifier!r} work item {name!r} names cycle "
                    f"index {index}, which is not declared"
                )
            cycle_id = cycle_ids[index]
            if cycle_id is not None:
                cycle_issue, _ = _find_active_or_tombstoned(
                    CycleIssue,
                    issue=issue,
                    cycle_id=cycle_id,
                    project=project,
                    workspace=workspace,
                )
                if cycle_issue is None:
                    CycleIssue.objects.create(
                        issue=issue,
                        cycle_id=cycle_id,
                        project=project,
                        workspace=workspace,
                        created_by=actor,
                    )
        if (index := item.get("module")) is not None:
            index = int(index)
            if index not in module_ids:
                raise BaselineError(
                    f"project {project.identifier!r} work item {name!r} names module "
                    f"index {index}, which is not declared"
                )
            module_id = module_ids[index]
            if module_id is not None:
                module_issue, _ = _find_active_or_tombstoned(
                    ModuleIssue,
                    issue=issue,
                    module_id=module_id,
                    project=project,
                    workspace=workspace,
                )
                if module_issue is None:
                    ModuleIssue.objects.create(
                        issue=issue,
                        module_id=module_id,
                        project=project,
                        workspace=workspace,
                        created_by=actor,
                    )
    return created, existing, assigned, labelled


class Command(BaseCommand):
    help = "Reconcile a tracked baseline manifest into this database"

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "manifest_dir",
            type=Path,
            help="directory holding the baseline manifests",
        )

    def handle(self, *args: Any, **options: Any) -> str | None:
        manifest_dir: Path = options["manifest_dir"]
        manifest = _load(manifest_dir)

        workspace_spec = manifest["workspace"].get("workspace") or {}
        slug = workspace_spec.get("slug")
        if not slug:
            raise BaselineError("workspace.slug is required")

        report: dict[str, Any] = {"operation": "reconcile", "workspace": slug}

        operator_spec = manifest["operator"].get("operator") or {}

        with transaction.atomic():
            workspace, workspace_tombstoned = _find_active_or_tombstoned(
                Workspace,
                slug=slug,
            )
            if workspace_tombstoned:
                report.update({"status": "passed", "workspace_tombstoned": True})
                self.stdout.write(json.dumps(report, indent=2, sort_keys=True))
                return None

            # Instance readiness comes first. An instance that has not completed
            # setup keeps its workspace client on the first-run screen, so
            # nothing reconciled below would be reachable through the UI.
            operator = _resolve_operator(operator_spec)
            with impersonate(operator):
                report.update(_ensure_instance(operator_spec, operator))
                workspace_created = workspace is None
                if workspace_created:
                    workspace = Workspace.objects.create(
                        slug=slug,
                        name=workspace_spec.get("name") or slug,
                        owner=operator,
                        organization_size=workspace_spec.get("organization_size"),
                        timezone=workspace_spec.get("timezone") or "UTC",
                    )
                report["workspace_created"] = workspace_created
                _ensure_workspace(workspace, operator)
                report["operator_onboarded"] = (
                    _ensure_operator_is_onboarded(workspace, operator) if workspace_created else []
                )

                # People first: a module lead, a work-item assignee, and a review
                # owner all name a member or a profile, so both must exist before
                # anything references them.
                members_report, member_ids = _ensure_members(workspace, manifest["members"])
                report.update(members_report)

                profiles = manifest["roster"].get("profiles") or {}
                if not profiles:
                    raise BaselineError("roster.profiles must declare at least one profile")

                projects_created = 0
                projects_existing = 0
                projects_tombstoned = 0
                project_members_created = 0
                projects: list[tuple[Project, dict[str, Any]]] = []
                project_ids: list[str] = []
                for spec in manifest["projects"].get("projects") or []:
                    project, was_created, tombstoned = _ensure_project(
                        workspace,
                        spec,
                        operator,
                    )
                    if tombstoned:
                        projects_tombstoned += 1
                        continue
                    project_ids.append(str(project.id))
                    projects.append((project, spec))
                    projects_created += int(was_created)
                    projects_existing += int(not was_created)
                    project_members_created += _ensure_project_members(
                        workspace,
                        project,
                        spec,
                        member_ids,
                    )
                report["project_members_created"] = project_members_created
                report["projects_tombstoned"] = projects_tombstoned

                roster_report, agent_ids = _ensure_roster(workspace, profiles, operator, project_ids)
                report.update(roster_report)

                # A work item may be assigned to a person or to an agent, so the two
                # maps are merged only after both exist. A key in both is a manifest
                # mistake rather than a merge to resolve silently.
                if overlap := set(member_ids) & set(agent_ids):
                    raise BaselineError(f"these keys name both a member and a profile: {sorted(overlap)}")
                assignee_ids = {**member_ids, **agent_ids}

                label_ids, labels_created = _ensure_labels(workspace, manifest["projects"], operator)
                report["labels_created"] = labels_created

                # Conversations are workspace-scoped and name no project, so they are
                # applied once rather than per project.
                channels_created, messages_created = _ensure_conversations(workspace, manifest["projects"], operator)
                report["channels_created"] = channels_created
                report["messages_created"] = messages_created

                items_created = 0
                items_existing = 0
                assignments_created = 0
                labels_applied = 0
                cycles_created = 0
                modules_created = 0
                pages_created = 0
                work_maps_created = 0
                bindings_created = 0
                intakes_created = 0
                intake_items_created = 0
                for project, spec in projects:
                    cycle_ids, made_cycles = _ensure_cycles(workspace, project, spec, operator)
                    module_ids, made_modules = _ensure_modules(workspace, project, spec, operator, member_ids)
                    cycles_created += made_cycles
                    modules_created += made_modules
                    pages_created += _ensure_pages(workspace, project, spec, operator)
                    # Work items and intake submissions come before the work maps,
                    # because a map binds its cards to work items and modules by
                    # name. Resolving a binding against a project whose items do not
                    # exist yet fails, and an idempotent re-run over populated data
                    # hides that: the items are already there from the first pass.
                    made, present, assigned, labelled = _ensure_work_items(
                        workspace,
                        project,
                        spec,
                        operator,
                        assignee_ids,
                        label_ids,
                        cycle_ids,
                        module_ids,
                    )
                    intakes, submitted = _ensure_intake(workspace, project, spec, operator)
                    maps, binds = _ensure_work_maps(workspace, project, spec, operator)
                    items_created += made
                    items_existing += present
                    assignments_created += assigned
                    labels_applied += labelled
                    intakes_created += intakes
                    intake_items_created += submitted
                    work_maps_created += maps
                    bindings_created += binds
                report["projects_created"] = projects_created
                report["projects_existing"] = projects_existing
                report["cycles_created"] = cycles_created
                report["modules_created"] = modules_created
                report["pages_created"] = pages_created
                report["work_maps_created"] = work_maps_created
                report["work_map_bindings_created"] = bindings_created
                report["intakes_created"] = intakes_created
                report["intake_items_created"] = intake_items_created
                report["work_items_created"] = items_created
                report["work_items_existing"] = items_existing
                report["assignments_created"] = assignments_created
                report["labels_applied"] = labels_applied

        report["status"] = "passed"
        self.stdout.write(json.dumps(report, indent=2, sort_keys=True))
        return None
