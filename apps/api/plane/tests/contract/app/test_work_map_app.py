# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import base64
import importlib
import uuid

import pytest
from django.apps import apps as django_apps
from django.utils import timezone
from rest_framework import status

from plane.db.models import (
    Cycle,
    Document,
    DocumentProject,
    Intake,
    IntakeIssue,
    Issue,
    IssueView,
    Module,
    Page,
    Project,
    ProjectMember,
    ProjectPage,
    State,
    WorkMap,
    WorkMapBinding,
)


def _project(workspace, user, identifier):
    project = Project.objects.create(
        name=f"Project {identifier}",
        identifier=identifier,
        workspace=workspace,
        cycle_view=True,
        module_view=True,
        issue_views_view=True,
        page_view=True,
        intake_view=True,
    )
    membership = ProjectMember.objects.create(
        workspace=workspace,
        project=project,
        member=user,
        role=20,
        is_active=True,
    )
    return project, membership


def _work_maps_url(workspace, project, work_map_id=None, suffix=""):
    base = f"/api/workspaces/{workspace.slug}/projects/{project.id}/work-maps/"
    return f"{base}{work_map_id}/{suffix}" if work_map_id else base


def _create_work_map(client, workspace, project):
    response = client.post(_work_maps_url(workspace, project), {"name": "Planning map"}, format="json")
    assert response.status_code == status.HTTP_201_CREATED
    return response.json()


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkMapApp:
    def test_page_backfill_preserves_page_and_project_link_ids(self, workspace, create_user):
        project, _ = _project(workspace, create_user, "LEG")
        page = Page.objects.create(workspace=workspace, owned_by=create_user, name="Legacy page")
        active_link = ProjectPage.objects.create(workspace=workspace, project=project, page=page)
        deleted_link = ProjectPage.objects.create(
            workspace=workspace,
            project=project,
            page=page,
            deleted_at=timezone.now(),
        )

        migration = importlib.import_module("plane.db.migrations.0123_document_work_map")
        migration.backfill_page_documents(django_apps, None)
        migration.backfill_page_documents(django_apps, None)

        document = Document.objects.get(pk=page.id)
        links = DocumentProject._base_manager.filter(document=document).order_by("id")
        assert document.id == page.id
        assert set(links.values_list("id", flat=True)) == {active_link.id, deleted_link.id}
        assert links.get(pk=active_link.id).deleted_at is None
        assert links.get(pk=deleted_link.id).deleted_at == deleted_link.deleted_at

    def test_create_uses_one_document_and_work_map_id(self, session_client, workspace, create_user):
        project, _ = _project(workspace, create_user, "MAP")

        payload = _create_work_map(session_client, workspace, project)

        document = Document.objects.get(id=payload["id"])
        work_map = WorkMap.objects.get(document_id=payload["id"])
        assert document.kind == Document.Kind.WORK_MAP
        assert document.id == work_map.pk
        assert document.document_projects.filter(project=project, deleted_at__isnull=True).exists()

    def test_scene_round_trip_and_stale_write_are_atomic(self, session_client, workspace, create_user):
        project, _ = _project(workspace, create_user, "SCN")
        work_map = _create_work_map(session_client, workspace, project)
        scene_url = _work_maps_url(workspace, project, work_map["id"], "scene/")
        scene = b"\x00excalidraw\xffscene"

        updated = session_client.patch(
            scene_url,
            {"generation": 0, "scene_binary": base64.b64encode(scene).decode("ascii")},
            format="json",
        )
        stale = session_client.patch(
            scene_url,
            {"generation": 0, "scene_binary": base64.b64encode(b"stale").decode("ascii")},
            format="json",
        )
        current = session_client.get(scene_url)

        assert updated.status_code == status.HTTP_200_OK
        assert updated.json()["generation"] == 1
        assert stale.status_code == status.HTTP_409_CONFLICT
        assert current.json() == {"generation": 1, "scene_binary": base64.b64encode(scene).decode("ascii")}

    def test_wrong_project_and_inactive_member_cannot_read_or_write_scene(self, session_client, workspace, create_user):
        project, membership = _project(workspace, create_user, "OWN")
        other_project, _ = _project(workspace, create_user, "OTH")
        work_map = _create_work_map(session_client, workspace, project)
        own_scene_url = _work_maps_url(workspace, project, work_map["id"], "scene/")
        other_scene_url = _work_maps_url(workspace, other_project, work_map["id"], "scene/")
        update = {"generation": 0, "scene_binary": base64.b64encode(b"denied").decode("ascii")}

        assert session_client.get(other_scene_url).status_code == status.HTTP_404_NOT_FOUND
        assert session_client.patch(other_scene_url, update, format="json").status_code == status.HTTP_404_NOT_FOUND

        membership.is_active = False
        membership.save(update_fields=["is_active"])
        assert session_client.get(own_scene_url).status_code == status.HTTP_403_FORBIDDEN
        assert session_client.patch(own_scene_url, update, format="json").status_code == status.HTTP_403_FORBIDDEN
        work_map_row = WorkMap.objects.get(pk=work_map["id"])
        assert bytes(work_map_row.scene_binary) == b""
        assert work_map_row.generation == 0

    def test_bindings_are_closed_authorized_and_absent_from_scene(self, session_client, workspace, create_user):
        project, _ = _project(workspace, create_user, "BND")
        state = State.objects.create(
            project=project,
            workspace=workspace,
            name="Backlog",
            color="#000000",
            group="backlog",
            default=True,
        )
        issue = Issue.objects.create(project=project, workspace=workspace, state=state, name="Work item")
        cycle = Cycle.objects.create(project=project, workspace=workspace, owned_by=create_user, name="Cycle")
        module = Module.objects.create(project=project, workspace=workspace, name="Module")
        view = IssueView.objects.create(
            project=project,
            workspace=workspace,
            owned_by=create_user,
            name="Project view",
            query={},
        )
        page = Page.objects.create(workspace=workspace, owned_by=create_user, name="Page")
        ProjectPage.objects.create(workspace=workspace, project=project, page=page)
        intake = Intake.objects.create(project=project, workspace=workspace, name="Intake")
        intake_item = IntakeIssue.objects.create(
            project=project,
            workspace=workspace,
            intake=intake,
            issue=issue,
        )
        work_map = _create_work_map(session_client, workspace, project)
        bindings_url = _work_maps_url(workspace, project, work_map["id"], "bindings/")
        sources = {
            "work-item": issue.id,
            "cycle": cycle.id,
            "module": module.id,
            "project-view": view.id,
            "page": page.id,
            "intake-item": intake_item.id,
        }

        responses = [
            session_client.post(bindings_url, {"source_kind": kind, "source_id": source_id}, format="json")
            for kind, source_id in sources.items()
        ]
        assert [response.status_code for response in responses] == [status.HTTP_201_CREATED] * 6
        assert WorkMapBinding.objects.filter(work_map_id=work_map["id"]).count() == 6

        repeated = session_client.post(
            bindings_url,
            {"source_kind": "work-item", "source_id": issue.id},
            format="json",
        )
        assert repeated.status_code == status.HTTP_200_OK
        assert repeated.json()["node_key"] == responses[0].json()["node_key"]
        assert WorkMapBinding.objects.filter(work_map_id=work_map["id"]).count() == 6

        invalid = session_client.post(
            bindings_url,
            {"source_kind": "unknown", "source_id": uuid.uuid4()},
            format="json",
        )
        assert invalid.status_code == status.HTTP_400_BAD_REQUEST
        assert WorkMapBinding.objects.filter(work_map_id=work_map["id"]).count() == 6

        existing_key = responses[0].json()["node_key"]
        other_issue = Issue.objects.create(project=project, workspace=workspace, state=state, name="Other")
        duplicate = session_client.post(
            bindings_url,
            {"node_key": existing_key, "source_kind": "work-item", "source_id": other_issue.id},
            format="json",
        )
        assert duplicate.status_code == status.HTTP_409_CONFLICT
        assert WorkMapBinding.objects.filter(work_map_id=work_map["id"]).count() == 6

        second_map = _create_work_map(session_client, workspace, project)
        cross_map_duplicate = session_client.post(
            _work_maps_url(workspace, project, second_map["id"], "bindings/"),
            {"node_key": existing_key, "source_kind": "cycle", "source_id": cycle.id},
            format="json",
        )
        assert cross_map_duplicate.status_code == status.HTTP_409_CONFLICT
        assert WorkMapBinding.objects.filter(work_map_id=second_map["id"]).count() == 0

        scene = session_client.get(_work_maps_url(workspace, project, work_map["id"], "scene/"))
        assert set(scene.json()) == {"generation", "scene_binary"}
        serialized_scene = str(scene.json())
        assert not any(str(source_id) in serialized_scene for source_id in sources.values())
        assert not any(kind in serialized_scene for kind in sources)
