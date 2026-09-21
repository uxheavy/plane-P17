# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Reconcile baseline conversations, work items, and intake submissions."""

from __future__ import annotations

from typing import Any

from plane.db.management.commands._dev_baseline.manifest import (
    BaselineError,
    _find_active_or_tombstoned,
)
from plane.db.models import (
    Channel,
    CycleIssue,
    Intake,
    IntakeIssue,
    Issue,
    IssueAssignee,
    IssueLabel,
    Message,
    ModuleIssue,
    Project,
    State,
    User,
    Workspace,
)


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
