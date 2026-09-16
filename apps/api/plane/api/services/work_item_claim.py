import uuid

from django.db import IntegrityError, transaction

from plane.db.models import (
    Issue,
    IssueActivity,
    IssueAssignee,
    Project,
    ProjectMember,
    State,
    StateGroup,
    User,
    WorkspaceAgentMembership,
    WorkspaceMember,
    WorkItemClaim,
)
from plane.db.models.project import ROLE
from plane.utils.agent import is_agent_user


class WorkItemClaimError(ValueError):
    pass


class WorkItemClaimConflict(WorkItemClaimError):
    pass


class WorkItemClaimNotFound(WorkItemClaimError):
    pass


class WorkItemClaimForbidden(PermissionError):
    pass


class WorkItemClaimUnavailable(WorkItemClaimError):
    pass


class WorkItemClaims:
    @staticmethod
    @transaction.atomic
    def claim(*, workspace_slug, project_id, issue_id, request_id, actor):
        try:
            request_id = uuid.UUID(str(request_id))
        except (TypeError, ValueError) as error:
            raise WorkItemClaimError("request_id must be a UUID") from error

        if (
            not actor.is_active
            or not is_agent_user(actor)
            or not User.objects.filter(id=actor.id, is_active=True).exists()
        ):
            raise WorkItemClaimForbidden("An active native agent is required")

        project = (
            Project.objects.filter(
                id=project_id,
                workspace__slug=workspace_slug,
                archived_at__isnull=True,
            )
            .select_related("workspace")
            .first()
        )
        if project is None:
            raise WorkItemClaimNotFound("Project not found")

        if not WorkspaceAgentMembership.objects.filter(
            workspace_id=project.workspace_id,
            user_id=actor.id,
            deleted_at__isnull=True,
        ).exists():
            raise WorkItemClaimForbidden("The agent is not active in this workspace")
        if not WorkspaceMember.objects.filter(
            workspace_id=project.workspace_id,
            member_id=actor.id,
            is_active=True,
            deleted_at__isnull=True,
        ).exists():
            raise WorkItemClaimForbidden("The agent is not an active workspace member")
        if not ProjectMember.objects.filter(
            project_id=project.id,
            member_id=actor.id,
            role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
            is_active=True,
            deleted_at__isnull=True,
        ).exists():
            raise WorkItemClaimForbidden("The agent is not an active project member")

        existing_request = (
            WorkItemClaim.objects.select_for_update(of=("self",))
            .select_related("issue__state", "workspace", "project")
            .filter(request_id=request_id)
            .first()
        )
        if replay := WorkItemClaims._replay_existing(
            existing_request,
            actor=actor,
            issue_id=issue_id,
            project=project,
            workspace_slug=workspace_slug,
        ):
            return replay

        issue = (
            Issue.objects.select_for_update(of=("self",))
            .select_related("state")
            .filter(
                id=issue_id,
                project_id=project.id,
                workspace_id=project.workspace_id,
                workspace__slug=workspace_slug,
            )
            .first()
        )
        if issue is None:
            raise WorkItemClaimNotFound("Work item not found")
        existing_request = (
            WorkItemClaim.objects.select_for_update(of=("self",))
            .select_related("issue__state", "workspace", "project")
            .filter(request_id=request_id)
            .first()
        )
        if replay := WorkItemClaims._replay_existing(
            existing_request,
            actor=actor,
            issue_id=issue_id,
            project=project,
            workspace_slug=workspace_slug,
        ):
            return replay
        if issue.archived_at is not None or issue.is_draft:
            raise WorkItemClaimUnavailable("Only active work items can be claimed")
        if issue.state is None or issue.state.group not in {
            StateGroup.BACKLOG.value,
            StateGroup.UNSTARTED.value,
        }:
            raise WorkItemClaimUnavailable("Only backlog or unstarted work items can be claimed")
        if not IssueAssignee.objects.filter(
            issue_id=issue.id,
            assignee_id=actor.id,
            deleted_at__isnull=True,
        ).exists():
            raise WorkItemClaimForbidden("The agent must already be assigned to the work item")

        active_claim = (
            WorkItemClaim.objects.select_for_update(of=("self",))
            .filter(issue_id=issue.id, released_at__isnull=True, deleted_at__isnull=True)
            .first()
        )
        if active_claim is not None:
            raise WorkItemClaimConflict("The work item is already claimed")

        started_state = (
            State.objects.filter(project_id=project.id, group=StateGroup.STARTED.value)
            .order_by("sequence", "id")
            .first()
        )
        if started_state is None:
            raise WorkItemClaimUnavailable("The project has no started state")

        try:
            with transaction.atomic():
                claim = WorkItemClaim.objects.create(
                    request_id=request_id,
                    issue=issue,
                    actor=actor,
                    project=project,
                    workspace=project.workspace,
                    created_by=actor,
                )
        except IntegrityError:
            existing_request = (
                WorkItemClaim.objects.select_for_update(of=("self",))
                .select_related("issue__state", "workspace", "project")
                .filter(request_id=request_id)
                .first()
            )
            if replay := WorkItemClaims._replay_existing(
                existing_request,
                actor=actor,
                issue_id=issue_id,
                project=project,
                workspace_slug=workspace_slug,
            ):
                return replay
            if WorkItemClaim.objects.filter(
                issue_id=issue.id,
                released_at__isnull=True,
                deleted_at__isnull=True,
            ).exists():
                raise WorkItemClaimConflict("The work item is already claimed")
            raise
        old_state = issue.state
        issue.state = started_state
        issue.save(update_fields=["state", "updated_at"])
        IssueActivity.objects.create(
            issue=issue,
            project=project,
            workspace=project.workspace,
            actor=actor,
            created_by=actor,
            verb="updated",
            field="state",
            old_value=old_state.name,
            new_value=started_state.name,
            old_identifier=old_state.id,
            new_identifier=started_state.id,
            comment="updated the state to",
        )
        return WorkItemClaims._response(claim, replayed=False)

    @staticmethod
    def _replay_existing(existing_request, *, actor, issue_id, project, workspace_slug):
        if existing_request is None:
            return None
        if (
            existing_request.actor_id != actor.id
            or existing_request.issue_id != issue_id
            or existing_request.project_id != project.id
            or existing_request.workspace.slug != workspace_slug
        ):
            raise WorkItemClaimConflict("request_id is already bound to another claim")
        return WorkItemClaims._response(existing_request, replayed=True)

    @staticmethod
    def _response(claim, *, replayed):
        state = claim.issue.state
        return {
            "claim_id": claim.id,
            "request_id": claim.request_id,
            "issue_id": claim.issue_id,
            "actor_id": claim.actor_id,
            "project_id": claim.project_id,
            "workspace_id": claim.workspace_id,
            "state_id": state.id,
            "state_name": state.name,
            "replayed": replayed,
        }
