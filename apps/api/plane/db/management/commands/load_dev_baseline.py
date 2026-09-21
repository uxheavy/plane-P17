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

from crum import impersonate
from django.core.management.base import BaseCommand
from django.db import transaction

from plane.db.management.commands._dev_baseline.content import (
    _ensure_conversations,
    _ensure_intake,
    _ensure_work_items,
)
from plane.db.management.commands._dev_baseline.documents import (
    _ensure_pages,
    _ensure_work_maps,
)
from plane.db.management.commands._dev_baseline.identity import (
    _ensure_instance,
    _ensure_members,
    _ensure_operator_is_onboarded,
    _ensure_roster,
    _ensure_workspace,
    _resolve_operator,
)
from plane.db.management.commands._dev_baseline.manifest import (
    BaselineError,
    _find_active_or_tombstoned,
    _load,
)
from plane.db.management.commands._dev_baseline.projects import (
    _ensure_cycles,
    _ensure_labels,
    _ensure_modules,
    _ensure_project,
    _ensure_project_members,
)
from plane.db.models import Project, Workspace


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
