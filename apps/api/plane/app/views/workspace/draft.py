# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import json

# Django imports
from django.utils import timezone
from django.core import serializers
from django.core.exceptions import ValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.contrib.postgres.aggregates import ArrayAgg
from django.contrib.postgres.fields import ArrayField
from django.db.models import Q, UUIDField, Value, Subquery, OuterRef
from django.db.models.functions import Coalesce
from django.db import transaction
from django.utils.decorators import method_decorator
from django.views.decorators.gzip import gzip_page

# Third Party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import allow_permission, ROLE
from plane.app.permissions.project import can_write_projects
from plane.api.services import (
    WorkItemCreationIntentConflict,
    WorkItemCreationIntents,
    WorkItemCreationOriginDenied,
)
from plane.app.serializers import (
    IssueCreateSerializer,
    DraftIssueCreateSerializer,
    DraftIssueSerializer,
    DraftIssueDetailSerializer,
)
from plane.db.models import (
    Issue,
    DraftIssue,
    Cycle,
    CycleIssue,
    Module,
    ModuleIssue,
    DraftIssueCycle,
    Workspace,
    Project,
    FileAsset,
    WorkItemCreationIntent,
)
from .. import BaseViewSet
from plane.bgtasks.issue_activities_task import issue_activity
from plane.utils.issue_filters import issue_filters
from plane.utils.host import base_host


class WorkspaceDraftIssueViewSet(BaseViewSet):
    model = DraftIssue

    def get_queryset(self):
        return (
            DraftIssue.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("workspace", "project", "state", "parent")
            .prefetch_related("assignees", "labels", "draft_issue_module__module")
            .annotate(
                cycle_id=Subquery(
                    DraftIssueCycle.objects.filter(draft_issue=OuterRef("id"), deleted_at__isnull=True).values(
                        "cycle_id"
                    )[:1]
                )
            )
            .annotate(
                label_ids=Coalesce(
                    ArrayAgg(
                        "labels__id",
                        distinct=True,
                        filter=Q(~Q(labels__id__isnull=True) & (Q(draft_label_issue__deleted_at__isnull=True))),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                assignee_ids=Coalesce(
                    ArrayAgg(
                        "assignees__id",
                        distinct=True,
                        filter=Q(
                            ~Q(assignees__id__isnull=True)
                            & Q(assignees__member_project__is_active=True)
                            & Q(draft_issue_assignee__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
                module_ids=Coalesce(
                    ArrayAgg(
                        "draft_issue_module__module_id",
                        distinct=True,
                        filter=Q(
                            ~Q(draft_issue_module__module_id__isnull=True)
                            & Q(draft_issue_module__module__archived_at__isnull=True)
                            & Q(draft_issue_module__deleted_at__isnull=True)
                        ),
                    ),
                    Value([], output_field=ArrayField(UUIDField())),
                ),
            )
        ).distinct()

    @method_decorator(gzip_page)
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        filters = issue_filters(request.query_params, "GET")
        issues = self.get_queryset().filter(created_by=request.user).order_by("-created_at")

        issues = issues.filter(**filters)
        # List Paginate
        return self.paginate(
            request=request,
            queryset=(issues),
            on_results=lambda issues: DraftIssueSerializer(issues, many=True).data,
        )

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def create(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        data = request.data.copy()
        creation_origin = None
        has_creation_origin = "creation_origin" in request.data and request.data.get("creation_origin") is not None
        if has_creation_origin:
            project_id = request.data.get("project_id")
            try:
                project = Project.objects.filter(pk=project_id, workspace=workspace).first()
            except (TypeError, ValueError, ValidationError):
                return Response(
                    {"error": "Project is required for creation_origin."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if project is None:
                return Response(
                    {"error": "Project is required for creation_origin."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not can_write_projects(user=request.user, workspace_id=workspace.id, project_ids=[project.id]):
                return Response(
                    {"error": "You don't have the required permissions."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            data.pop("creation_origin", None)
            try:
                with transaction.atomic():
                    creation_origin = WorkItemCreationIntents.validate_origin(
                        origin=request.data.get("creation_origin"),
                        actor=request.user,
                        project=project,
                        slug=slug,
                    )
            except WorkItemCreationOriginDenied as error:
                return Response({"error": str(error)}, status=status.HTTP_403_FORBIDDEN)
            except WorkItemCreationIntentConflict as error:
                return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)

        serializer = DraftIssueCreateSerializer(
            data=data,
            context={
                "workspace_id": workspace.id,
                "project_id": request.data.get("project_id", None),
            },
        )
        if serializer.is_valid():
            if has_creation_origin:
                serializer.save(creation_origin=creation_origin)
            else:
                serializer.save()
            issue = (
                self.get_queryset()
                .filter(pk=serializer.data.get("id"))
                .values(
                    "id",
                    "name",
                    "state_id",
                    "sort_order",
                    "completed_at",
                    "estimate_point",
                    "priority",
                    "start_date",
                    "target_date",
                    "project_id",
                    "parent_id",
                    "cycle_id",
                    "module_ids",
                    "label_ids",
                    "assignee_ids",
                    "created_at",
                    "updated_at",
                    "created_by",
                    "updated_by",
                    "type_id",
                    "description_html",
                    "creation_origin",
                )
                .first()
            )

            return Response(issue, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(
        allowed_roles=[ROLE.ADMIN, ROLE.MEMBER],
        creator=True,
        model=Issue,
        level="WORKSPACE",
    )
    def partial_update(self, request, slug, pk):
        issue = self.get_queryset().filter(pk=pk, created_by=request.user).first()

        if not issue:
            return Response({"error": "Issue not found"}, status=status.HTTP_404_NOT_FOUND)

        project_id = request.data.get("project_id", issue.project_id)

        serializer = DraftIssueCreateSerializer(
            issue,
            data=request.data,
            partial=True,
            context={
                "project_id": project_id,
                "cycle_id": request.data.get("cycle_id", "not_provided"),
            },
        )

        if serializer.is_valid():
            serializer.save()

            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=Issue, level="WORKSPACE")
    def retrieve(self, request, slug, pk=None):
        issue = self.get_queryset().filter(pk=pk, created_by=request.user).first()

        if not issue:
            return Response(
                {"error": "The required object does not exist."},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = DraftIssueDetailSerializer(issue)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission(allowed_roles=[ROLE.ADMIN], creator=True, model=DraftIssue, level="WORKSPACE")
    def destroy(self, request, slug, pk=None):
        draft_issue = DraftIssue.objects.get(workspace__slug=slug, pk=pk)
        draft_issue.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def create_draft_to_issue(self, request, slug, draft_id):
        draft_issue = self.get_queryset().filter(pk=draft_id, created_by=request.user).first()

        if not draft_issue:
            intent = (
                WorkItemCreationIntent.objects.filter(
                    id=draft_id,
                    created_by=request.user,
                    project__workspace__slug=slug,
                    issue__isnull=False,
                )
                .select_related("project", "issue")
                .first()
            )
            if intent is not None:
                return self._convert_origin_backed_draft_to_issue(
                    request=request,
                    slug=slug,
                    draft_issue=None,
                    intent=intent,
                )
            return Response(
                {"error": "The required object does not exist."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not draft_issue.project_id:
            return Response(
                {"error": "Project is required to create an issue."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not self._draft_records_match_project(request=request, project_id=draft_issue.project_id):
            return Response(
                {"error": "Cycle and module references must belong to the draft project."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if draft_issue.creation_origin is not None:
            return self._convert_origin_backed_draft_to_issue(
                request=request,
                slug=slug,
                draft_issue=draft_issue,
                intent=None,
            )

        serializer = IssueCreateSerializer(
            data=request.data,
            context={
                "project_id": draft_issue.project_id,
                "workspace_id": draft_issue.project.workspace_id,
                "default_assignee_id": draft_issue.project.default_assignee_id,
            },
        )

        if serializer.is_valid():
            serializer.save()
            issue_activity.delay(
                type="issue.activity.created",
                requested_data=json.dumps(self.request.data, cls=DjangoJSONEncoder),
                actor_id=str(request.user.id),
                issue_id=str(serializer.data.get("id", None)),
                project_id=str(draft_issue.project_id),
                current_instance=None,
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=True),
            )
            self._attach_draft_records(
                request=request,
                draft_issue=draft_issue,
                issue_id=serializer.data.get("id", None),
            )
            draft_issue.delete()

            return Response(serializer.data, status=status.HTTP_201_CREATED)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def _convert_origin_backed_draft_to_issue(self, *, request, slug, draft_issue, intent):
        project = draft_issue.project if draft_issue is not None else intent.project
        if not can_write_projects(user=request.user, workspace_id=project.workspace_id, project_ids=[project.id]):
            return Response(
                {"error": "You don't have the required permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not self._draft_records_match_project(request=request, project_id=project.id):
            return Response(
                {"error": "Cycle and module references must belong to the draft project."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        origin = (
            draft_issue.creation_origin
            if draft_issue is not None
            else WorkItemCreationIntents.origin_for_intent(intent)
        )
        issue_payload = request.data.copy()
        issue_payload.pop("creation_origin", None)

        try:
            with transaction.atomic():
                origin = WorkItemCreationIntents.validate_origin(
                    origin=origin,
                    actor=request.user,
                    project=project,
                    slug=slug,
                    check_generation=draft_issue is not None,
                )
        except WorkItemCreationOriginDenied as error:
            return Response({"error": str(error)}, status=status.HTTP_403_FORBIDDEN)
        except WorkItemCreationIntentConflict as error:
            return Response({"error": str(error)}, status=status.HTTP_409_CONFLICT)

        serializer = IssueCreateSerializer(
            data=issue_payload,
            context={
                "project_id": project.id,
                "workspace_id": project.workspace_id,
                "default_assignee_id": project.default_assignee_id,
            },
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        intent_id = draft_issue.id if draft_issue is not None else intent.id
        payload_hash = WorkItemCreationIntents.payload_hash(issue_payload, origin)
        try:
            with transaction.atomic():
                intent, created = WorkItemCreationIntents.reserve(
                    intent_id=intent_id,
                    origin=origin,
                    actor=request.user,
                    project=project,
                    payload_hash=payload_hash,
                    slug=slug,
                )
                if not created:
                    if intent.origin_kind == "conversation":
                        WorkItemCreationIntents.ensure_conversation_source_link(
                            request=request,
                            slug=slug,
                            intent=intent,
                        )
                    replay_serializer = IssueCreateSerializer(
                        intent.issue,
                        data=issue_payload,
                        context={
                            "project_id": project.id,
                            "workspace_id": project.workspace_id,
                            "default_assignee_id": project.default_assignee_id,
                        },
                    )
                    if not replay_serializer.is_valid():
                        return Response(replay_serializer.errors, status=status.HTTP_400_BAD_REQUEST)
                    if draft_issue is not None:
                        draft_issue.delete()
                    response_data = replay_serializer.data
                    response_status = status.HTTP_200_OK
                else:
                    issue_instance = serializer.save(
                        created_by_id=request.user.id,
                        updated_by_id=request.user.id,
                    )
                    intent.issue_id = issue_instance.id
                    intent.save(update_fields=["issue", "updated_at"])
                    WorkItemCreationIntents.complete(
                        intent=intent,
                        issue=issue_instance,
                        origin=origin,
                        actor=request.user,
                        project=project,
                        slug=slug,
                    )
                    if intent.origin_kind == "conversation":
                        WorkItemCreationIntents.ensure_conversation_source_link(
                            request=request,
                            slug=slug,
                            intent=intent,
                        )
                    if draft_issue is not None:
                        self._attach_draft_records(
                            request=request,
                            draft_issue=draft_issue,
                            issue_id=issue_instance.id,
                        )
                        draft_issue.delete()
                    response_data = serializer.data
                    response_status = status.HTTP_201_CREATED

                    transaction.on_commit(
                        lambda: issue_activity.delay(
                            type="issue.activity.created",
                            requested_data=json.dumps(request.data, cls=DjangoJSONEncoder),
                            actor_id=str(request.user.id),
                            issue_id=str(issue_instance.id),
                            project_id=str(project.id),
                            current_instance=None,
                            epoch=int(timezone.now().timestamp()),
                            notification=True,
                            origin=base_host(request=request, is_app=True),
                        )
                    )
        except WorkItemCreationOriginDenied as error:
            return Response({"error": str(error)}, status=status.HTTP_403_FORBIDDEN)
        except WorkItemCreationIntentConflict as error:
            return Response({"error": str(error)}, status=status.HTTP_409_CONFLICT)

        return Response(response_data, status=response_status)

    @staticmethod
    def _attach_draft_records(*, request, draft_issue, issue_id):
        if request.data.get("cycle_id"):
            created_record = CycleIssue.objects.create(
                cycle_id=request.data.get("cycle_id"),
                issue_id=issue_id,
                project_id=draft_issue.project_id,
                workspace_id=draft_issue.workspace_id,
                created_by_id=draft_issue.created_by_id,
                updated_by_id=draft_issue.updated_by_id,
            )
            transaction.on_commit(
                lambda: issue_activity.delay(
                    type="cycle.activity.created",
                    requested_data=None,
                    actor_id=str(request.user.id),
                    issue_id=None,
                    project_id=str(draft_issue.project_id),
                    current_instance=json.dumps(
                        {
                            "updated_cycle_issues": None,
                            "created_cycle_issues": serializers.serialize("json", [created_record]),
                        }
                    ),
                    epoch=int(timezone.now().timestamp()),
                    notification=True,
                    origin=base_host(request=request, is_app=True),
                )
            )

        module_ids = request.data.get("module_ids", [])
        if module_ids:
            ModuleIssue.objects.bulk_create(
                [
                    ModuleIssue(
                        module_id=module,
                        issue_id=issue_id,
                        workspace_id=draft_issue.workspace_id,
                        project_id=draft_issue.project_id,
                        created_by_id=draft_issue.created_by_id,
                        updated_by_id=draft_issue.updated_by_id,
                    )
                    for module in module_ids
                ],
                batch_size=10,
            )
            for module in module_ids:
                transaction.on_commit(
                    lambda module=module: issue_activity.delay(
                        type="module.activity.created",
                        requested_data=json.dumps({"module_id": str(module)}),
                        actor_id=str(request.user.id),
                        issue_id=str(issue_id),
                        project_id=draft_issue.project_id,
                        current_instance=None,
                        epoch=int(timezone.now().timestamp()),
                        notification=True,
                        origin=base_host(request=request, is_app=True),
                    )
                )

        FileAsset.objects.filter(draft_issue_id=draft_issue.id).update(
            issue_id=issue_id,
            entity_type=FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
            draft_issue_id=None,
        )

    @staticmethod
    def _draft_records_match_project(*, request, project_id):
        cycle_id = request.data.get("cycle_id")
        if cycle_id:
            try:
                if not Cycle.objects.filter(id=cycle_id, project_id=project_id, deleted_at__isnull=True).exists():
                    return False
            except (TypeError, ValueError, ValidationError):
                return False

        module_ids = request.data.get("module_ids", [])
        if not module_ids:
            return True
        if not isinstance(module_ids, list):
            return False
        try:
            requested_module_ids = {str(module_id) for module_id in module_ids}
            project_module_ids = {
                str(module_id)
                for module_id in Module.objects.filter(
                    id__in=module_ids,
                    project_id=project_id,
                    deleted_at__isnull=True,
                ).values_list("id", flat=True)
            }
        except (TypeError, ValueError, ValidationError):
            return False
        return requested_module_ids == project_module_ids and len(requested_module_ids) == len(module_ids)
