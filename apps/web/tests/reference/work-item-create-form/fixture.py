# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

# Copyright (c) 2026 Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import hashlib
import json
import os

from django.contrib.auth.hashers import make_password
from django.db import connection, transaction
from django.utils import timezone

from plane.api.services import WorkspaceAgentMemberships
from plane.db.models import (
    BotTypeEnum,
    Cycle,
    Estimate,
    EstimatePoint,
    Issue,
    Label,
    Module,
    Profile,
    Project,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceAgentMembership,
    WorkspaceMember,
)
from plane.license.models import Instance, InstanceConfiguration
from plane.utils.cache import invalidate_cache_directly


ACTION = os.environ.get("PLANE_REFERENCE_ACTION", "setup")
RUN_KEY = hashlib.sha256(os.environ["PLANE_REFERENCE_RUN_ID"].encode()).hexdigest()[:12]
SLUG = f"picker-reference-{RUN_KEY}"
EMAIL = os.environ["PLANE_REFERENCE_EMAIL"]
PASSWORD = os.environ["PLANE_REFERENCE_PASSWORD"]
MEMBER_PREFIX = f"picker-reference-member-{RUN_KEY}-"
SEED_EMAIL = f"picker-reference-seed-{RUN_KEY}@agents.invalid"
LOCK_KEY = "reference_work_item_create_form_lock"
COUNTS = {
    "members": 500,
    "labels": 1000,
    "modules": 500,
    "cycles": 250,
    "states": 50,
    "estimate_points": 50,
}


def cleanup():
    with transaction.atomic():
        instance = Instance.objects.select_for_update().first()
        claim = (
            InstanceConfiguration.all_objects.select_for_update()
            .filter(key=LOCK_KEY, deleted_at__isnull=True)
            .first()
        )
        if claim is None:
            return False

        owner = json.loads(claim.value)
        if owner["run_key"] != RUN_KEY:
            raise RuntimeError(f"Reference fixture is owned by run {owner['run_key']}")
        if instance is None or str(instance.id) != owner["instance_id"]:
            raise RuntimeError("Reference fixture instance changed during the run")

        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL plane.agent_lifecycle = 'on'")
        workspace = Workspace.objects.filter(slug=SLUG).first()
        agent_user_ids = (
            list(
                WorkspaceAgentMembership.objects.filter(workspace=workspace).values_list(
                    "user_id", flat=True
                )
            )
            if workspace
            else []
        )
        Workspace.objects.filter(slug=SLUG).delete(soft=False)
        User.objects.filter(id__in=agent_user_ids).delete()
        User.objects.filter(email=EMAIL).delete()
        User.objects.filter(email__startswith=MEMBER_PREFIX).delete()
        User.objects.filter(email=SEED_EMAIL).delete()
        claim.delete(soft=False)
        if owner["instance_created"]:
            instance.delete(soft=False)
        else:
            instance.is_setup_done = owner["instance_setup_was_done"]
            instance.save(update_fields=["is_setup_done", "updated_at"])
        invalidate_cache_directly(path="/api/instances/", user=False)
        return True


def setup():
    with transaction.atomic():
        instance = Instance.objects.select_for_update().first()
        instance_created = instance is None
        if instance is None:
            instance = Instance.objects.create(
                instance_name="Plane Reference",
                instance_id=f"picker-reference-{RUN_KEY}",
                current_version="reference",
                domain="http://reference.invalid",
                last_checked_at=timezone.now(),
                is_setup_done=False,
                is_test=True,
                is_telemetry_enabled=False,
                is_support_required=False,
            )
        claim = (
            InstanceConfiguration.all_objects.select_for_update()
            .filter(key=LOCK_KEY)
            .first()
        )
        if claim is not None:
            if claim.deleted_at is None:
                owner = json.loads(claim.value)
                raise RuntimeError(
                    f"Reference fixture is owned by run {owner['run_key']}"
                )
            claim.delete(soft=False)
        collisions = [
            name
            for name, exists in (
                ("workspace slug", Workspace.objects.filter(slug=SLUG).exists()),
                ("reference email", User.objects.filter(email=EMAIL).exists()),
                (
                    "member email prefix",
                    User.objects.filter(email__startswith=MEMBER_PREFIX).exists(),
                ),
            )
            if exists
        ]
        if collisions:
            raise RuntimeError(
                f"Reference fixture identifiers already exist: {', '.join(collisions)}"
            )

        instance_setup_was_done = instance.is_setup_done
        InstanceConfiguration.objects.create(
            key=LOCK_KEY,
            value=json.dumps(
                {
                    "run_key": RUN_KEY,
                    "instance_id": str(instance.id),
                    "instance_created": instance_created,
                    "instance_setup_was_done": instance_setup_was_done,
                }
            ),
            category="REFERENCE_TEST",
        )
        if not instance_setup_was_done:
            instance.is_setup_done = True
            instance.save(update_fields=["is_setup_done", "updated_at"])
            invalidate_cache_directly(path="/api/instances/", user=False)

        owner = User(
            email=EMAIL,
            username=EMAIL,
            first_name="Picker",
            last_name="Reference",
            display_name="Picker Reference",
            is_active=True,
            is_email_verified=True,
            is_email_valid=True,
            password=make_password(PASSWORD),
        )
        owner.save()
        Profile.objects.create(
            user=owner,
            is_onboarded=True,
            is_tour_completed=True,
            onboarding_step={
                "profile_complete": True,
                "workspace_create": True,
                "workspace_invite": True,
                "workspace_join": True,
            },
        )

        workspace = Workspace.objects.create(
            name=f"Picker Reference {RUN_KEY}", slug=SLUG, owner=owner
        )
        WorkspaceMember.objects.create(workspace=workspace, member=owner, role=20)
        project = Project.objects.create(
            name="High Cardinality Options",
            identifier="REF",
            workspace=workspace,
            project_lead=owner,
            module_view=True,
            cycle_view=True,
        )
        ProjectMember.objects.create(
            project=project, workspace=workspace, member=owner, role=20
        )
        for agent_key, display_name, state in (
            ("agent-a", "Reference Agent A", "active"),
            ("agent-b", "Reference Agent B", "active"),
            ("agent-disabled", "Reference Agent Disabled", "disabled"),
        ):
            WorkspaceAgentMemberships.apply(
                workspace_id=workspace.id,
                agent_key=f"{RUN_KEY}-{agent_key}",
                desired={
                    "display_name": display_name,
                    "state": state,
                    "project_ids": [str(project.id)],
                    "credential_action": "ensure",
                },
                idempotency_key=f"{RUN_KEY}-create-{agent_key}",
                actor=owner,
            )
        seed = User.objects.create(
            email=SEED_EMAIL,
            username=SEED_EMAIL,
            display_name="Reference Workspace Seed",
            is_bot=True,
            bot_type=BotTypeEnum.WORKSPACE_SEED,
            is_active=True,
        )
        WorkspaceMember.objects.create(
            workspace=workspace, member=seed, role=15, is_active=True
        )
        ProjectMember.objects.create(
            project=project,
            workspace=workspace,
            member=seed,
            role=15,
            is_active=True,
        )

        users = [
            User(
                email=f"{MEMBER_PREFIX}{index:04d}@example.test",
                username=f"{MEMBER_PREFIX}{index:04d}@example.test",
                first_name="Picker",
                last_name=f"Member {index:04d}",
                display_name=f"Picker Member {index:04d}",
                is_active=True,
                is_email_verified=True,
                is_email_valid=True,
                password="!",
            )
            for index in range(COUNTS["members"] - 1)
        ]
        User.objects.bulk_create(users)
        users = list(
            User.objects.filter(email__startswith=MEMBER_PREFIX).order_by("email")
        )
        Profile.objects.bulk_create(
            [Profile(user=user, is_onboarded=True) for user in users]
        )
        WorkspaceMember.objects.bulk_create(
            [
                WorkspaceMember(workspace=workspace, member=user, role=15)
                for user in users
            ]
        )
        ProjectMember.objects.bulk_create(
            [
                ProjectMember(
                    project=project, workspace=workspace, member=user, role=15
                )
                for user in users
            ]
        )

        State.all_state_objects.bulk_create(
            [
                State(
                    workspace=workspace,
                    project=project,
                    name=f"Reference State {index:03d}",
                    slug=f"reference-state-{index:03d}",
                    color="#60646C",
                    sequence=index * 1000,
                    group=["backlog", "unstarted", "started", "completed", "cancelled"][
                        index % 5
                    ],
                    default=index == 0,
                )
                for index in range(COUNTS["states"])
            ]
        )
        project.default_state = (
            State.objects.filter(project=project).order_by("sequence").first()
        )

        Label.objects.bulk_create(
            [
                Label(
                    workspace=workspace,
                    project=project,
                    name=f"Reference Label {index:04d}",
                    color=f"#{(index * 2654435761) & 0xFFFFFF:06x}",
                    sort_order=index,
                )
                for index in range(COUNTS["labels"])
            ]
        )
        Module.objects.bulk_create(
            [
                Module(
                    workspace=workspace,
                    project=project,
                    name=f"Reference Module {index:04d}",
                    status="planned",
                    sort_order=index,
                )
                for index in range(COUNTS["modules"])
            ]
        )
        Cycle.objects.bulk_create(
            [
                Cycle(
                    workspace=workspace,
                    project=project,
                    name=f"Reference Cycle {index:04d}",
                    owned_by=owner,
                    sort_order=index,
                )
                for index in range(COUNTS["cycles"])
            ]
        )
        estimate = Estimate.objects.create(
            workspace=workspace,
            project=project,
            name="Reference Estimate",
            type="points",
            last_used=True,
        )
        EstimatePoint.objects.bulk_create(
            [
                EstimatePoint(
                    workspace=workspace,
                    project=project,
                    estimate=estimate,
                    key=index,
                    value=str(index),
                )
                for index in range(COUNTS["estimate_points"])
            ]
        )
        project.estimate = estimate
        project.save(update_fields=["default_state", "estimate", "updated_at"])
        owner.profile.last_workspace_id = workspace.id
        owner.profile.save(update_fields=["last_workspace_id", "updated_at"])

    return {
        "workspace_slug": workspace.slug,
        "project_id": str(project.id),
        "instance_setup_was_done": instance_setup_was_done,
        "counts": COUNTS,
        "total_options": sum(COUNTS.values()),
    }


def assert_created_work_items():
    project = Project.objects.get(workspace__slug=SLUG, identifier="REF")
    minimal = Issue.objects.get(project=project, name="Reference minimal work item")
    rich = Issue.objects.get(
        project=project, name="Reference high-cardinality work item"
    )
    child = Issue.objects.get(project=project, name="Reference child work item")

    assert child.parent_id == minimal.id
    assert rich.state.name == "Reference State 049"
    assert rich.estimate_point.value == "49"
    assert list(rich.labels.values_list("name", flat=True)) == ["Reference Label 0999"]
    assert list(rich.assignees.values_list("display_name", flat=True)) == [
        "Reference Agent A"
    ]
    assert list(rich.issue_module.values_list("module__name", flat=True)) == [
        "Reference Module 0499"
    ]
    assert list(rich.issue_cycle.values_list("cycle__name", flat=True)) == [
        "Reference Cycle 0249"
    ]

    return {
        "created": [minimal.name, rich.name, child.name],
        "child_parent": minimal.name,
        "rich": {
            "state": rich.state.name,
            "estimate": rich.estimate_point.value,
            "label": "Reference Label 0999",
            "assignee": "Reference Agent A",
            "module": "Reference Module 0499",
            "cycle": "Reference Cycle 0249",
        },
    }


if ACTION == "setup":
    result = setup()
elif ACTION == "assert":
    result = assert_created_work_items()
elif ACTION == "cleanup":
    result = {"cleaned": SLUG, "owned": cleanup()}
else:
    raise ValueError(f"Unknown PLANE_REFERENCE_ACTION: {ACTION}")

print(json.dumps(result, sort_keys=True))
