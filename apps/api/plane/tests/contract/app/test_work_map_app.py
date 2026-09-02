# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import base64
import importlib
import json
import uuid
from datetime import timedelta
from unittest.mock import Mock, patch

import pytest
from django.apps import apps as django_apps
from django.conf import settings
from django.utils import timezone
from rest_framework import status
from botocore.exceptions import EndpointConnectionError

from plane.app.permissions import ROLE
from plane.app.serializers.asset import WORK_MAP_SCENE_ASSET_MIME_TYPES
from plane.app.serializers.work_map import MAX_WORK_MAP_SCENE_BYTES, WorkMapSceneSerializer
from plane.app.views.work_map.duplicate import mark_failed_after_cleanup as mark_duplicate_failed
from plane.app.views.work_map.duplicate import renew_copy_lease as renew_duplicate_lease
from plane.app.views.work_map.duplicate import WorkMapSourceChanged
from plane.app.views.work_map.paste import mark_failed_after_cleanup as mark_paste_failed
from plane.app.views.work_map.paste import renew_copy_lease as renew_paste_lease
from plane.app.views.work_map.paste import WorkMapPasteSourceUnavailable
from plane.app.views.work_map.paste import authorized_paste_sources
from plane.bgtasks.deletion_task import hard_delete
from plane.bgtasks.page_version_task import track_page_version
from plane.bgtasks.work_map_asset_task import cleanup_deleted_work_map_assets, cleanup_stale_work_map_asset_copies
from plane.bgtasks.work_map_binding_task import expire_stale_work_map_binding_placements
from plane.db.models import (
    Cycle,
    DeployBoard,
    Document,
    DocumentProject,
    DocumentVersion,
    DocumentVersionAsset,
    FileAsset,
    Intake,
    IntakeIssue,
    Issue,
    IssueView,
    Module,
    Page,
    PageVersion,
    Project,
    ProjectMember,
    State,
    User,
    UserRecentVisit,
    WorkMap,
    WorkMapBinding,
    WorkMapBindingPlacement,
    WorkMapDuplicateOperation,
    WorkMapPasteRebinding,
    WorkMapSceneAssetPlacement,
    WorkMapVersion,
    WorkspaceMember,
)
from plane.settings.storage import S3Storage


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


def _work_map_scene_assets_url(workspace, project, work_map_id, asset_id=None):
    base = f"/api/assets/v2/workspaces/{workspace.slug}/projects/{project.id}/work-maps/{work_map_id}/scene-assets/"
    return f"{base}{asset_id}/" if asset_id else base


def _source_records(workspace, project, user):
    state = State.objects.create(
        project=project,
        workspace=workspace,
        name="Backlog",
        color="#000000",
        group="backlog",
        default=True,
    )
    issue = Issue.objects.create(project=project, workspace=workspace, state=state, name="Work item")
    cycle = Cycle.objects.create(project=project, workspace=workspace, owned_by=user, name="Cycle")
    module = Module.objects.create(project=project, workspace=workspace, name="Module")
    view = IssueView.objects.create(
        project=project,
        workspace=workspace,
        owned_by=user,
        name="Project view",
        query={},
    )
    page = Page.objects.create(workspace=workspace, owned_by=user, name="Page")
    DocumentProject.objects.create(workspace=workspace, project=project, document=page)
    intake = Intake.objects.create(project=project, workspace=workspace, name="Intake")
    intake_item = IntakeIssue.objects.create(project=project, workspace=workspace, intake=intake, issue=issue)
    return {
        "work-item": issue,
        "cycle": cycle,
        "module": module,
        "project-view": view,
        "page": page,
        "intake-item": intake_item,
    }


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkMapApp:
    def test_work_map_cleanup_task_is_registered(self):
        assert "plane.bgtasks.work_map_asset_task" in settings.CELERY_IMPORTS
        assert "plane.bgtasks.work_map_binding_task" in settings.CELERY_IMPORTS
        assert (
            cleanup_stale_work_map_asset_copies.name
            == "plane.bgtasks.work_map_asset_task.cleanup_stale_work_map_asset_copies"
        )
        assert (
            expire_stale_work_map_binding_placements.name
            == "plane.bgtasks.work_map_binding_task.expire_stale_work_map_binding_placements"
        )

    def test_s3_storage_batches_deletes_and_aggregates_failures(self):
        storage = S3Storage.__new__(S3Storage)
        storage.aws_storage_bucket_name = "test-bucket"
        storage.s3_client = Mock(
            delete_objects=Mock(
                side_effect=[
                    {"Errors": [{"Key": "retained-key", "Code": "AccessDenied"}]},
                    {"Deleted": [{"Key": "object-1000"}]},
                ]
            )
        )

        assert storage.delete_files([f"object-{index}" for index in range(1001)]) is False
        assert [len(call.kwargs["Delete"]["Objects"]) for call in storage.s3_client.delete_objects.call_args_list] == [
            1000,
            1,
        ]

    def test_s3_storage_normalizes_copy_transport_failures(self):
        storage = S3Storage.__new__(S3Storage)
        storage.aws_storage_bucket_name = "test-bucket"
        storage.s3_client = Mock(
            copy_object=Mock(side_effect=EndpointConnectionError(endpoint_url="https://storage.invalid"))
        )

        with patch("plane.settings.storage.log_exception"):
            assert storage.copy_object("source", "destination") is None

    def test_internal_work_map_validation_errors_are_not_disclosed(self, session_client, workspace, create_user):
        project, _ = _project(workspace, create_user, "ERR")
        work_map = _create_work_map(session_client, workspace, project)
        scene_url = _work_maps_url(workspace, project, work_map["id"], "scene/")
        versions_url = _work_maps_url(workspace, project, work_map["id"], "versions/")
        private_detail = "private validation detail"
        scene_binary = base64.b64encode(b'{"elements":[],"files":{}}').decode("ascii")

        with patch(
            "plane.app.views.work_map.scene.decode_work_map_scene",
            side_effect=ValueError(private_detail),
        ):
            invalid_scene = session_client.patch(
                scene_url,
                {"generation": 0, "scene_binary": scene_binary},
                format="json",
            )
        with patch(
            "plane.app.views.work_map.version.decode_work_map_scene",
            side_effect=ValueError(private_detail),
        ):
            invalid_version = session_client.post(versions_url, {}, format="json")

        version = session_client.post(versions_url, {}, format="json")
        assert version.status_code == status.HTTP_201_CREATED
        with patch(
            "plane.app.views.work_map.version.decode_work_map_scene",
            side_effect=ValueError(private_detail),
        ):
            invalid_restore = session_client.post(
                f"{versions_url}{version.json()['id']}/restore/",
                {"generation": 0},
                format="json",
            )
        with patch(
            "plane.app.views.work_map.duplicate.decode_work_map_scene",
            side_effect=ValueError(private_detail),
        ):
            invalid_duplicate = session_client.post(
                _work_maps_url(workspace, project, work_map["id"], "duplicate/"),
                {},
                format="json",
                HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
            )

        for response, public_message in (
            (invalid_scene, "Work map scene is invalid"),
            (invalid_version, "Work map version cannot be created"),
            (invalid_restore, "Work map version cannot be restored"),
            (invalid_duplicate, "Work map cannot be duplicated"),
        ):
            assert response.status_code == status.HTTP_409_CONFLICT
            assert response.json() == {"error": public_message}
            assert private_detail not in response.content.decode()

    def test_stale_asset_copy_lease_cannot_delete_new_owner_keys(self, session_client, workspace, create_user):
        project, _ = _project(workspace, create_user, "LSE")
        work_map = WorkMap.objects.get(pk=_create_work_map(session_client, workspace, project)["id"])
        current_lease = uuid.uuid4()
        stale_lease = uuid.uuid4()
        duplicate = WorkMapDuplicateOperation.objects.create(
            source_work_map=work_map,
            idempotency_key=uuid.uuid4(),
            source_generation=work_map.generation,
            source_scene_hash="scene",
            target_document_id=uuid.uuid4(),
            destination_keys=["new-owner-key"],
            lease_id=current_lease,
            created_by=create_user,
        )
        paste = WorkMapPasteRebinding.objects.create(
            work_map=work_map,
            idempotency_key=uuid.uuid4(),
            request_hash="request",
            generation=work_map.generation,
            destination_keys=["new-owner-key"],
            lease_id=current_lease,
            created_by=create_user,
        )

        for operation, cleanup in ((duplicate, mark_duplicate_failed), (paste, mark_paste_failed)):
            storage = Mock()
            cleanup(operation, stale_lease, storage)
            storage.delete_files.assert_not_called()
            operation.refresh_from_db()
            assert operation.status == operation.Status.COPYING
            assert operation.lease_id == current_lease

            storage.delete_files.return_value = False
            cleanup(operation, current_lease, storage)
            operation.refresh_from_db()
            assert operation.status == operation.Status.COPYING
            assert operation.lease_id == current_lease

        for operation, renew, error in (
            (duplicate, renew_duplicate_lease, WorkMapSourceChanged),
            (paste, renew_paste_lease, WorkMapPasteSourceUnavailable),
        ):
            operation.__class__.objects.filter(id=operation.id).update(lease_expires_at=timezone.now())
            renew(operation.id, current_lease)
            operation.refresh_from_db()
            assert operation.lease_expires_at > timezone.now()
            with pytest.raises(error):
                renew(operation.id, stale_lease)

        for operation, cleanup in ((duplicate, mark_duplicate_failed), (paste, mark_paste_failed)):
            storage = Mock()
            storage.delete_files.return_value = True
            cleanup(operation, current_lease, storage)
            operation.refresh_from_db()
            assert operation.status == operation.Status.FAILED
            assert operation.deleted_at is not None

    def test_work_map_scene_asset_types_match_native_excalidraw(self):
        assert set(WORK_MAP_SCENE_ASSET_MIME_TYPES) == {
            "image/avif",
            "image/bmp",
            "image/gif",
            "image/jpeg",
            "image/jfif",
            "image/png",
            "image/svg+xml",
            "image/webp",
            "image/x-icon",
        }

    def test_work_map_scene_reserves_transport_headroom(self):
        accepted = WorkMapSceneSerializer(
            data={
                "generation": 0,
                "scene_binary": base64.b64encode(b"x" * MAX_WORK_MAP_SCENE_BYTES).decode("ascii"),
            }
        )
        rejected = WorkMapSceneSerializer(
            data={
                "generation": 0,
                "scene_binary": base64.b64encode(b"x" * (MAX_WORK_MAP_SCENE_BYTES + 1)).decode("ascii"),
            }
        )

        assert accepted.is_valid(), accepted.errors
        assert not rejected.is_valid()
        assert rejected.errors == {"scene_binary": ["Scene binary exceeds the Work Map limit."]}

    def test_page_asset_backfill_uses_the_shared_document_owner(self, workspace, create_user):
        project, _ = _project(workspace, create_user, "LEG")
        page = Page.objects.create(workspace=workspace, owned_by=create_user, name="Legacy page")
        DocumentProject.objects.create(workspace=workspace, project=project, document=page)
        page_asset = FileAsset(
            workspace=workspace,
            project=project,
            page=page,
            document_id=page.id,
            asset="legacy-page-asset",
            entity_type=FileAsset.EntityTypeContext.PAGE_DESCRIPTION,
            is_uploaded=True,
        )
        FileAsset.objects.bulk_create([page_asset])
        asset_migration = importlib.import_module("plane.db.migrations.0126_document_assets")
        asset_migration.backfill_page_asset_documents(django_apps, None)
        asset_migration.backfill_page_asset_documents(django_apps, None)
        page_asset.refresh_from_db()
        assert page_asset.page_id == page.id
        assert page_asset.document_id == page.id

        page.description_html = f'<image-component src="{page_asset.id}"></image-component>'
        page.save(update_fields=["description_html"])
        track_page_version(page.id, json.dumps({"description_html": ""}), create_user.id)
        page_version = PageVersion.objects.get(document_id=page.id)
        assert page_version.document_version_ptr_id == page_version.id
        assert set(page_version.asset_links.values_list("asset_id", flat=True)) == {page_asset.id}

        missing_asset_id = uuid.uuid4()
        missing_version = PageVersion.objects.create(
            document=page,
            workspace=workspace,
            owned_by=create_user,
            description_html=f'<image-component src="{missing_asset_id}"></image-component>',
        )
        asset_migration.backfill_page_version_assets(django_apps, None)
        assert not missing_version.asset_links.exists()

        other_page = Page.objects.create(workspace=workspace, owned_by=create_user, name="Other page")
        wrong_asset = FileAsset.objects.create(
            workspace=workspace,
            project=project,
            page=other_page,
            document=other_page,
            asset="wrong-page-asset",
            entity_type=FileAsset.EntityTypeContext.PAGE_DESCRIPTION,
            is_uploaded=True,
        )
        PageVersion.objects.create(
            document=page,
            workspace=workspace,
            owned_by=create_user,
            description_html=f'<image-component src="{wrong_asset.id}"></image-component>',
        )
        with pytest.raises(RuntimeError, match="not owned by its Document"):
            asset_migration.backfill_page_version_assets(django_apps, None)

    def test_page_version_keeps_history_when_a_referenced_asset_is_missing(self, workspace, create_user):
        page = Page.objects.create(
            workspace=workspace,
            owned_by=create_user,
            name="Page with missing asset",
            description_html=f'<image-component src="{uuid.uuid4()}"></image-component>',
        )

        track_page_version(page.id, json.dumps({"description_html": ""}), create_user.id)

        version = PageVersion.objects.get(document_id=page.id)
        assert version.description_html == page.description_html
        assert not version.asset_links.exists()

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
        scene = b'{"elements":[],"files":{}}'

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

        work_map_url = _work_maps_url(workspace, project, work_map["id"])
        lock_url = _work_maps_url(workspace, project, work_map["id"], "lock/")
        assert session_client.post(lock_url).status_code == status.HTTP_204_NO_CONTENT
        acknowledged = session_client.patch(
            scene_url,
            {"generation": 0, "scene_binary": base64.b64encode(scene).decode("ascii")},
            format="json",
        )
        assert acknowledged.status_code == status.HTTP_200_OK
        assert acknowledged.json() == {"generation": 1}
        assert session_client.patch(work_map_url, {"name": "Blocked"}, format="json").status_code == 409
        assert session_client.delete(lock_url).status_code == status.HTTP_204_NO_CONTENT
        current_work_map = WorkMap.objects.get(pk=work_map["id"])
        assert current_work_map.collaboration_epoch == 2
        assert current_work_map.generation == 1

        archive_url = _work_maps_url(workspace, project, work_map["id"], "archive/")
        archived = session_client.post(archive_url)
        archived_again = session_client.post(archive_url)
        assert archived.status_code == status.HTTP_200_OK
        assert archived_again.status_code == status.HTTP_200_OK
        assert archived.json() == archived_again.json()
        acknowledged = session_client.patch(
            scene_url,
            {"generation": 0, "scene_binary": base64.b64encode(scene).decode("ascii")},
            format="json",
        )
        assert acknowledged.status_code == status.HTTP_200_OK
        assert acknowledged.json() == {"generation": 1}
        assert session_client.patch(work_map_url, {"name": "Blocked"}, format="json").status_code == 409
        assert session_client.delete(archive_url).status_code == status.HTTP_204_NO_CONTENT
        current_work_map.refresh_from_db()
        assert current_work_map.collaboration_epoch == 4
        assert current_work_map.generation == 1

    def test_realtime_authorization_returns_the_collaboration_epoch(self, session_client, workspace, create_user):
        project, membership = _project(workspace, create_user, "LIV")
        other_project, _ = _project(workspace, create_user, "ALT")
        denied_project, _ = _project(workspace, create_user, "DEN")
        work_map = _create_work_map(session_client, workspace, project)
        DocumentProject.objects.create(document_id=work_map["id"], project=other_project, workspace=workspace)
        realtime_url = _work_maps_url(workspace, project, work_map["id"], "realtime/")

        authorized = session_client.get(realtime_url)
        assert authorized.status_code == status.HTTP_200_OK
        assert authorized.json()["collaboration_epoch"] == 0
        assert authorized.json()["editable"] is True
        linked_authorized = session_client.get(_work_maps_url(workspace, other_project, work_map["id"], "realtime/"))
        assert linked_authorized.status_code == status.HTTP_200_OK
        assert linked_authorized.json()["project_id"] == str(other_project.id)
        assert linked_authorized.json()["work_map_id"] == work_map["id"]

        membership.role = 5
        membership.save(update_fields=["role"])
        assert session_client.get(realtime_url).json()["editable"] is True
        workspace_membership = WorkspaceMember.objects.get(workspace=workspace, member=create_user)
        workspace_membership.role = 5
        workspace_membership.save(update_fields=["role"])
        assert session_client.get(realtime_url).json()["editable"] is False
        assert (
            session_client.get(_work_maps_url(workspace, denied_project, work_map["id"], "realtime/")).status_code
            == status.HTTP_404_NOT_FOUND
        )

    def test_active_workspace_admin_can_manage_a_work_map_through_an_active_project_membership(
        self, session_client, workspace, create_user
    ):
        project, _ = _project(workspace, create_user, "ADM")
        work_map = _create_work_map(session_client, workspace, project)
        admin = User.objects.create_user(email="work-map-admin@plane.so", username="work-map-admin")
        WorkspaceMember.objects.create(workspace=workspace, member=admin, role=ROLE.ADMIN.value, is_active=True)
        ProjectMember.objects.create(
            workspace=workspace,
            project=project,
            member=admin,
            role=ROLE.GUEST.value,
            is_active=True,
        )
        session_client.force_authenticate(user=admin)

        archived = session_client.post(_work_maps_url(workspace, project, work_map["id"], "archive/"))

        assert archived.status_code == status.HTTP_200_OK
        assert Document.objects.get(id=work_map["id"]).archived_at is not None

    def test_work_map_unlinks_projects_before_archive_and_reclaims_final_document_assets(
        self, session_client, workspace, create_user
    ):
        first_project, _ = _project(workspace, create_user, "DEL")
        second_project, _ = _project(workspace, create_user, "END")
        removed_project, _ = _project(workspace, create_user, "OLD")
        work_map = _create_work_map(session_client, workspace, first_project)
        document = Document.objects.get(id=work_map["id"])
        DocumentProject.objects.bulk_create(
            [
                DocumentProject(
                    document=document,
                    project=project,
                    workspace=workspace,
                    created_by=create_user,
                )
                for project in (second_project, removed_project)
            ]
        )
        asset = FileAsset.objects.create(
            document=document,
            workspace=workspace,
            asset="document-owned-scene-asset",
            entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
            is_uploaded=True,
        )
        first_url = _work_maps_url(workspace, first_project, work_map["id"])
        second_url = _work_maps_url(workspace, second_project, work_map["id"])

        removed_project.delete(soft=False)
        assert FileAsset.objects.filter(id=asset.id, project_id__isnull=True).exists()

        assert session_client.delete(first_url).status_code == status.HTTP_204_NO_CONTENT
        assert Document.objects.filter(id=work_map["id"]).exists()
        assert not DocumentProject.objects.filter(document_id=work_map["id"], project=first_project).exists()
        assert DocumentProject.objects.filter(document_id=work_map["id"], project=second_project).exists()
        assert FileAsset.objects.filter(id=asset.id).exists()

        assert session_client.delete(second_url).status_code == status.HTTP_409_CONFLICT
        assert session_client.post(f"{second_url}archive/").status_code == status.HTTP_200_OK
        with (
            patch("plane.app.views.work_map.base.transaction.on_commit", side_effect=lambda callback: callback()),
            patch("plane.bgtasks.work_map_asset_task.cleanup_deleted_work_map_assets.delay") as schedule_cleanup,
        ):
            assert session_client.delete(second_url).status_code == status.HTTP_204_NO_CONTENT
        schedule_cleanup.assert_called_once_with(work_map["id"])
        assert not Document.objects.filter(id=work_map["id"]).exists()
        assert Document.all_objects.filter(id=work_map["id"], deleted_at__isnull=False).exists()
        deleted_asset = FileAsset.all_objects.get(id=asset.id)
        assert deleted_asset.deleted_at is not None
        assert deleted_asset.asset.name == "document-owned-scene-asset"

        with patch("plane.bgtasks.work_map_asset_task.S3Storage.delete_files", return_value=False):
            cleanup_deleted_work_map_assets(work_map["id"])
        deleted_asset.refresh_from_db()
        assert deleted_asset.asset.name == "document-owned-scene-asset"

        expired_at = timezone.now() - timedelta(days=settings.HARD_DELETE_AFTER_DAYS + 1)
        Document.all_objects.filter(id=work_map["id"]).update(deleted_at=expired_at)
        FileAsset.all_objects.filter(id=asset.id).update(deleted_at=expired_at)
        hard_delete()
        assert Document.all_objects.filter(id=work_map["id"]).exists()

        with patch("plane.bgtasks.work_map_asset_task.S3Storage.delete_files", return_value=True) as delete_files:
            cleanup_deleted_work_map_assets(work_map["id"])
        delete_files.assert_called_once_with(["document-owned-scene-asset"])
        hard_delete()
        assert not Document.all_objects.filter(id=work_map["id"]).exists()

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

    def test_editor_can_preserve_an_existing_carrier_without_source_access(
        self, session_client, workspace, create_user
    ):
        map_project, _ = _project(workspace, create_user, "MAPAUTH")
        source_project, _ = _project(workspace, create_user, "SRCAUTH")
        state = State.objects.create(
            project=source_project,
            workspace=workspace,
            name="Backlog",
            color="#000000",
            group="backlog",
            default=True,
        )
        issue = Issue.objects.create(project=source_project, workspace=workspace, state=state, name="Protected")
        work_map = _create_work_map(session_client, workspace, map_project)
        binding = session_client.post(
            _work_maps_url(workspace, map_project, work_map["id"], "bindings/"),
            {
                "generation": 0,
                "placement_id": uuid.uuid4(),
                "source_kind": "work-item",
                "source_id": issue.id,
            },
            format="json",
        ).json()
        carrier = {
            "id": "protected",
            "type": "embeddable",
            "link": f"https://work-map.invalid/nodes/{binding['node_key']}",
            "customData": {"nodeKey": binding["node_key"]},
        }
        scene_url = _work_maps_url(workspace, map_project, work_map["id"], "scene/")
        initial_scene = json.dumps({"elements": [carrier], "files": {}}).encode()
        assert (
            session_client.patch(
                scene_url,
                {"generation": 0, "scene_binary": base64.b64encode(initial_scene).decode("ascii")},
                format="json",
            ).status_code
            == status.HTTP_200_OK
        )

        editor = User.objects.create_user(email="work-map-editor@plane.so", username="work-map-editor")
        WorkspaceMember.objects.create(workspace=workspace, member=editor, role=ROLE.MEMBER.value, is_active=True)
        ProjectMember.objects.create(
            workspace=workspace,
            project=map_project,
            member=editor,
            role=ROLE.MEMBER.value,
            is_active=True,
        )
        session_client.force_authenticate(user=editor)
        edited_scene = json.dumps({"elements": [carrier, {"id": "note", "type": "rectangle"}], "files": {}}).encode()

        preserved = session_client.patch(
            scene_url,
            {"generation": 1, "scene_binary": base64.b64encode(edited_scene).decode("ascii")},
            format="json",
        )

        assert preserved.status_code == status.HTTP_200_OK
        assert preserved.json() == {"generation": 2}

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
        DocumentProject.objects.create(workspace=workspace, project=project, document=page)
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

        placements = {kind: uuid.uuid4() for kind in sources}
        responses = [
            session_client.post(
                bindings_url,
                {
                    "generation": 0,
                    "placement_id": placements[kind],
                    "source_kind": kind,
                    "source_id": source_id,
                },
                format="json",
            )
            for kind, source_id in sources.items()
        ]
        assert [response.status_code for response in responses] == [status.HTTP_201_CREATED] * 6
        assert WorkMapBinding.objects.filter(work_map_id=work_map["id"]).count() == 6

        repeated = session_client.post(
            bindings_url,
            {
                "generation": 0,
                "placement_id": placements["work-item"],
                "source_kind": "work-item",
                "source_id": issue.id,
            },
            format="json",
        )
        assert repeated.status_code == status.HTTP_200_OK
        assert repeated.json()["node_key"] == responses[0].json()["node_key"]
        assert WorkMapBinding.objects.filter(work_map_id=work_map["id"]).count() == 6

        shared_binding = session_client.post(
            bindings_url,
            {
                "generation": 0,
                "placement_id": uuid.uuid4(),
                "source_kind": "work-item",
                "source_id": issue.id,
            },
            format="json",
        )
        assert shared_binding.status_code == status.HTTP_201_CREATED
        assert shared_binding.json()["node_key"] == responses[0].json()["node_key"]
        assert WorkMapBinding.objects.filter(work_map_id=work_map["id"]).count() == 6
        assert WorkMapBindingPlacement.objects.filter(work_map_id=work_map["id"]).count() == 7

        other_issue = Issue.objects.create(project=project, workspace=workspace, state=state, name="Other")
        reused_placement = session_client.post(
            bindings_url,
            {
                "generation": 0,
                "placement_id": placements["work-item"],
                "source_kind": "work-item",
                "source_id": other_issue.id,
            },
            format="json",
        )
        assert reused_placement.status_code == status.HTTP_409_CONFLICT
        assert WorkMapBinding.objects.filter(work_map_id=work_map["id"]).count() == 6

        second_map = _create_work_map(session_client, workspace, project)
        second_map_binding = session_client.post(
            _work_maps_url(workspace, project, second_map["id"], "bindings/"),
            {
                "generation": 0,
                "placement_id": uuid.uuid4(),
                "source_kind": "cycle",
                "source_id": cycle.id,
            },
            format="json",
        )
        assert second_map_binding.status_code == status.HTTP_201_CREATED
        assert second_map_binding.json()["node_key"] != responses[1].json()["node_key"]
        assert WorkMapBinding.objects.filter(work_map_id=second_map["id"]).count() == 1

        scene = session_client.get(_work_maps_url(workspace, project, work_map["id"], "scene/"))
        assert set(scene.json()) == {"generation", "scene_binary"}
        serialized_scene = str(scene.json())
        assert not any(str(source_id) in serialized_scene for source_id in sources.values())
        assert not any(kind in serialized_scene for kind in sources)

    def test_binding_placement_cancellation_tracks_the_last_native_carrier(
        self, session_client, workspace, create_user
    ):
        project, _ = _project(workspace, create_user, "PLC")
        state = State.objects.create(
            project=project,
            workspace=workspace,
            name="Backlog",
            color="#000000",
            group="backlog",
            default=True,
        )
        issue = Issue.objects.create(project=project, workspace=workspace, state=state, name="Work item")
        work_map = _create_work_map(session_client, workspace, project)
        bindings_url = _work_maps_url(workspace, project, work_map["id"], "bindings/")
        first_placement = uuid.uuid4()
        second_placement = uuid.uuid4()

        first = session_client.post(
            bindings_url,
            {
                "generation": 0,
                "placement_id": first_placement,
                "source_kind": "work-item",
                "source_id": issue.id,
            },
            format="json",
        )
        second = session_client.post(
            bindings_url,
            {
                "generation": 0,
                "placement_id": second_placement,
                "source_kind": "work-item",
                "source_id": issue.id,
            },
            format="json",
        )
        assert first.status_code == status.HTTP_201_CREATED
        assert second.status_code == status.HTTP_201_CREATED
        assert first.json()["node_key"] == second.json()["node_key"]

        cancel_first = _work_maps_url(
            workspace,
            project,
            work_map["id"],
            f"binding-placements/{first_placement}/",
        )
        assert session_client.delete(f"{cancel_first}?generation=0").status_code == status.HTTP_204_NO_CONTENT
        binding = WorkMapBinding.objects.get(work_map_id=work_map["id"])
        assert WorkMapBindingPlacement.objects.filter(binding=binding).count() == 1

        node_key = first.json()["node_key"]
        two_carriers = json.dumps(
            {
                "elements": [
                    {
                        "id": element_id,
                        "type": "embeddable",
                        "link": f"https://work-map.invalid/nodes/{node_key}",
                        "customData": {"nodeKey": node_key},
                    }
                    for element_id in ("first", "second")
                ],
                "files": {},
            }
        ).encode()
        scene_url = _work_maps_url(workspace, project, work_map["id"], "scene/")
        saved = session_client.patch(
            scene_url,
            {"generation": 0, "scene_binary": base64.b64encode(two_carriers).decode("ascii")},
            format="json",
        )
        assert saved.status_code == status.HTTP_200_OK
        placement = WorkMapBindingPlacement.objects.get(binding=binding)
        assert placement.acknowledged_at is not None

        cancel_second = _work_maps_url(
            workspace,
            project,
            work_map["id"],
            f"binding-placements/{second_placement}/",
        )
        assert session_client.delete(f"{cancel_second}?generation=1").status_code == status.HTTP_204_NO_CONTENT
        assert WorkMapBinding.objects.filter(id=binding.id).exists()

        one_carrier = json.loads(two_carriers)
        one_carrier["elements"].pop()
        removed_duplicate = session_client.patch(
            scene_url,
            {
                "generation": 1,
                "scene_binary": base64.b64encode(json.dumps(one_carrier).encode()).decode("ascii"),
            },
            format="json",
        )
        assert removed_duplicate.status_code == status.HTTP_200_OK
        assert WorkMapBinding.objects.filter(id=binding.id).exists()

        removed_last = session_client.patch(
            scene_url,
            {
                "generation": 2,
                "scene_binary": base64.b64encode(b'{"elements":[],"files":{}}').decode("ascii"),
            },
            format="json",
        )
        assert removed_last.status_code == status.HTTP_200_OK
        assert not WorkMapBinding.objects.filter(id=binding.id).exists()

        restored = session_client.patch(
            scene_url,
            {
                "generation": 3,
                "scene_binary": base64.b64encode(json.dumps(one_carrier).encode()).decode("ascii"),
            },
            format="json",
        )
        assert restored.status_code == status.HTTP_200_OK
        assert WorkMapBinding.objects.filter(id=binding.id).exists()

        removed_again = session_client.patch(
            scene_url,
            {
                "generation": 4,
                "scene_binary": base64.b64encode(b'{"elements":[],"files":{}}').decode("ascii"),
            },
            format="json",
        )
        assert removed_again.status_code == status.HTTP_200_OK
        replacement_placement = uuid.uuid4()
        replacement = session_client.post(
            bindings_url,
            {
                "generation": 5,
                "placement_id": replacement_placement,
                "source_kind": "work-item",
                "source_id": issue.id,
            },
            format="json",
        )
        assert replacement.status_code == status.HTTP_201_CREATED
        cancel_replacement = _work_maps_url(
            workspace,
            project,
            work_map["id"],
            f"binding-placements/{replacement_placement}/",
        )
        assert session_client.delete(f"{cancel_replacement}?generation=5").status_code == status.HTTP_204_NO_CONTENT
        assert not WorkMapBinding.objects.filter(id=binding.id).exists()

    def test_stale_binding_placements_finalize_or_expire_from_the_persisted_scene(
        self, session_client, workspace, create_user
    ):
        project, _ = _project(workspace, create_user, "EXP")
        state = State.objects.create(
            project=project,
            workspace=workspace,
            name="Backlog",
            color="#000000",
            group="backlog",
            default=True,
        )
        kept_issue = Issue.objects.create(project=project, workspace=workspace, state=state, name="Kept")
        abandoned_issue = Issue.objects.create(project=project, workspace=workspace, state=state, name="Abandoned")
        work_map_data = _create_work_map(session_client, workspace, project)
        bindings_url = _work_maps_url(workspace, project, work_map_data["id"], "bindings/")
        kept = session_client.post(
            bindings_url,
            {
                "generation": 0,
                "placement_id": uuid.uuid4(),
                "source_kind": "work-item",
                "source_id": kept_issue.id,
            },
            format="json",
        ).json()
        abandoned = session_client.post(
            bindings_url,
            {
                "generation": 0,
                "placement_id": uuid.uuid4(),
                "source_kind": "work-item",
                "source_id": abandoned_issue.id,
            },
            format="json",
        ).json()
        WorkMapBindingPlacement.objects.filter(work_map_id=work_map_data["id"]).update(
            created_at=timezone.now() - timedelta(minutes=16)
        )
        work_map = WorkMap.objects.get(pk=work_map_data["id"])
        work_map.scene_binary = json.dumps(
            {
                "elements": [
                    {
                        "id": "kept",
                        "type": "embeddable",
                        "link": f"https://work-map.invalid/nodes/{kept['node_key']}",
                        "customData": {"nodeKey": kept["node_key"]},
                    }
                ],
                "files": {},
            }
        ).encode()
        work_map.save(update_fields=["scene_binary"])

        with patch("plane.db.mixins.soft_delete_related_objects.delay") as recursive_delete:
            expire_stale_work_map_binding_placements()

        kept_placement = WorkMapBindingPlacement.objects.get(binding__node_key=kept["node_key"])
        assert kept_placement.acknowledged_at is not None
        assert not WorkMapBinding.objects.filter(node_key=abandoned["node_key"]).exists()
        assert WorkMapBinding.all_objects.filter(node_key=abandoned["node_key"], deleted_at__isnull=False).exists()
        recursive_delete.assert_not_called()

        WorkMapBindingPlacement.objects.filter(id=kept_placement.id).update(
            acknowledged_at=timezone.now() - timedelta(days=settings.HARD_DELETE_AFTER_DAYS + 1)
        )
        expire_stale_work_map_binding_placements()
        assert not WorkMapBindingPlacement.all_objects.filter(id=kept_placement.id).exists()

    def test_cross_map_paste_rebinds_before_native_insertion_and_replays(self, session_client, workspace, create_user):
        project, membership = _project(workspace, create_user, "PST")
        state = State.objects.create(
            project=project,
            workspace=workspace,
            name="Backlog",
            color="#000000",
            group="backlog",
            default=True,
        )
        issue = Issue.objects.create(project=project, workspace=workspace, state=state, name="Work item")
        source = _create_work_map(session_client, workspace, project)
        target = _create_work_map(session_client, workspace, project)
        source_binding = session_client.post(
            _work_maps_url(workspace, project, source["id"], "bindings/"),
            {
                "generation": 0,
                "placement_id": uuid.uuid4(),
                "source_kind": "work-item",
                "source_id": issue.id,
            },
            format="json",
        ).json()
        source_asset = FileAsset.objects.create(
            workspace=workspace,
            document_id=source["id"],
            asset="paste-source-asset",
            attributes={"name": "source.png", "type": "image/png"},
            entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
            is_uploaded=True,
        )
        source_scene = json.dumps(
            {
                "elements": [
                    {
                        "id": "source-node",
                        "type": "embeddable",
                        "link": f"https://work-map.invalid/nodes/{source_binding['node_key']}",
                        "customData": {"nodeKey": source_binding["node_key"]},
                    },
                    {"id": "source-image", "type": "image", "fileId": "source-file"},
                ],
                "files": {
                    "source-file": {
                        "assetId": str(source_asset.id),
                        "mimeType": "image/png",
                        "created": 1,
                    }
                },
            }
        ).encode()
        assert (
            session_client.patch(
                _work_maps_url(workspace, project, source["id"], "scene/"),
                {"generation": 0, "scene_binary": base64.b64encode(source_scene).decode("ascii")},
                format="json",
            ).status_code
            == status.HTTP_200_OK
        )

        paste_url = _work_maps_url(workspace, project, target["id"], "paste-rebindings/")
        idempotency_key = uuid.uuid4()
        payload = {
            "generation": 0,
            "idempotency_key": idempotency_key,
            "node_keys": [source_binding["node_key"]],
            "files": [{"file_id": "source-file", "asset_id": source_asset.id}],
        }
        with patch("plane.app.views.work_map.paste.S3Storage.copy_object", return_value={}):
            pasted = session_client.post(paste_url, payload, format="json")
        assert pasted.status_code == status.HTTP_201_CREATED
        assert set(pasted.json()) == {"generation", "node_keys", "files"}
        target_key = pasted.json()["node_keys"][source_binding["node_key"]]
        target_asset_id = pasted.json()["files"]["source-file"]
        assert target_key != source_binding["node_key"]
        assert target_asset_id != str(source_asset.id)
        assert str(issue.id) not in str(pasted.json())
        assert WorkMapBinding.objects.filter(work_map_id=target["id"], node_key=target_key).exists()
        assert WorkMapSceneAssetPlacement.objects.filter(
            work_map_id=target["id"],
            asset_id=target_asset_id,
        ).exists()

        target_scene = json.loads(source_scene)
        target_scene["elements"][0]["link"] = f"https://work-map.invalid/nodes/{target_key}"
        target_scene["elements"][0]["customData"]["nodeKey"] = target_key
        target_scene["files"]["source-file"]["assetId"] = target_asset_id
        inserted = session_client.patch(
            _work_maps_url(workspace, project, target["id"], "scene/"),
            {
                "generation": 0,
                "scene_binary": base64.b64encode(json.dumps(target_scene).encode()).decode("ascii"),
            },
            format="json",
        )
        assert inserted.status_code == status.HTTP_200_OK
        assert not WorkMapSceneAssetPlacement.objects.filter(asset_id=target_asset_id).exists()

        replayed = session_client.post(paste_url, payload, format="json")
        assert replayed.status_code == status.HTTP_200_OK
        assert replayed.json() == pasted.json()
        receipt = WorkMapPasteRebinding.all_objects.get(
            work_map_id=target["id"],
            idempotency_key=idempotency_key,
        )
        assert receipt.status == WorkMapPasteRebinding.Status.COMMITTED
        assert receipt.deleted_at is not None

        denied_target = _create_work_map(session_client, workspace, project)
        denied_payload = {**payload, "idempotency_key": uuid.uuid4()}
        authorization_calls = 0

        def revoke_after_source_recheck(**kwargs):
            nonlocal authorization_calls
            result = authorized_paste_sources(**kwargs)
            authorization_calls += 1
            if authorization_calls == 2:
                ProjectMember.objects.filter(id=membership.id).update(is_active=False)
            return result

        with (
            patch(
                "plane.app.views.work_map.paste.authorized_paste_sources",
                side_effect=revoke_after_source_recheck,
            ),
            patch("plane.app.views.work_map.paste.S3Storage.copy_object", return_value={}),
            patch(
                "plane.app.views.work_map.paste.S3Storage.delete_files",
                return_value=True,
            ),
        ):
            denied = session_client.post(
                _work_maps_url(workspace, project, denied_target["id"], "paste-rebindings/"),
                denied_payload,
                format="json",
            )
        assert denied.status_code == status.HTTP_409_CONFLICT
        assert not WorkMapBinding.objects.filter(work_map_id=denied_target["id"]).exists()

    def test_cross_map_paste_bounds_file_copies(self, session_client, workspace, create_user):
        project, _ = _project(workspace, create_user, "PFL")
        target = _create_work_map(session_client, workspace, project)
        idempotency_key = uuid.uuid4()

        response = session_client.post(
            _work_maps_url(workspace, project, target["id"], "paste-rebindings/"),
            {
                "generation": 0,
                "idempotency_key": idempotency_key,
                "node_keys": [],
                "files": [{"file_id": f"file-{index}", "asset_id": uuid.uuid4()} for index in range(101)],
            },
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert not WorkMapPasteRebinding.all_objects.filter(idempotency_key=idempotency_key).exists()

    def test_duplicate_replaces_every_binding_key_atomically(self, session_client, workspace, create_user):
        project, _ = _project(workspace, create_user, "DUP")
        source_project, source_membership = _project(workspace, create_user, "SRC")
        state = State.objects.create(
            project=source_project,
            workspace=workspace,
            name="Backlog",
            color="#000000",
            group="backlog",
            default=True,
        )
        issue = Issue.objects.create(project=source_project, workspace=workspace, state=state, name="Work item")
        work_map = _create_work_map(session_client, workspace, project)
        binding = session_client.post(
            _work_maps_url(workspace, project, work_map["id"], "bindings/"),
            {
                "generation": 0,
                "placement_id": uuid.uuid4(),
                "source_kind": "work-item",
                "source_id": issue.id,
            },
            format="json",
        ).json()
        duplicate_url = _work_maps_url(workspace, project, work_map["id"], "duplicate/")
        scene_url = _work_maps_url(workspace, project, work_map["id"], "scene/")
        missing_carrier_scene = json.dumps({"elements": [], "files": {}}).encode()
        session_client.patch(
            scene_url,
            {"generation": 0, "scene_binary": base64.b64encode(missing_carrier_scene).decode("ascii")},
            format="json",
        )
        incomplete = session_client.post(
            duplicate_url,
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
        )
        assert incomplete.status_code == status.HTTP_409_CONFLICT
        assert Document.objects.filter(kind=Document.Kind.WORK_MAP).count() == 1

        source_key = binding["node_key"]
        source_scene = json.dumps(
            {
                "elements": [
                    {
                        "id": "plane-node",
                        "type": "embeddable",
                        "link": f"https://work-map.invalid/nodes/{source_key}",
                        "customData": {"nodeKey": source_key},
                    },
                    {
                        "id": "native-embed",
                        "type": "embeddable",
                        "link": "https://example.invalid",
                        "customData": {"enabledOrigin": "https://example.invalid"},
                    },
                ],
                "files": {},
            }
        ).encode()
        leaked_scene = json.loads(source_scene)
        leaked_scene["elements"][0]["sourceKind"] = "work-item"
        rejected_leak = session_client.patch(
            scene_url,
            {
                "generation": 1,
                "scene_binary": base64.b64encode(json.dumps(leaked_scene).encode()).decode("ascii"),
            },
            format="json",
        )
        assert rejected_leak.status_code == status.HTTP_409_CONFLICT
        session_client.patch(
            scene_url,
            {"generation": 1, "scene_binary": base64.b64encode(source_scene).decode("ascii")},
            format="json",
        )
        client_scene = session_client.post(duplicate_url, {"scene_binary": "bypass"}, format="json")
        assert client_scene.status_code == status.HTTP_400_BAD_REQUEST
        assert Document.objects.filter(kind=Document.Kind.WORK_MAP).count() == 1

        duplicate_key = str(uuid.uuid4())
        duplicated = session_client.post(
            duplicate_url,
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY=duplicate_key,
        )

        assert duplicated.status_code == status.HTTP_201_CREATED
        duplicate = WorkMap.objects.get(pk=duplicated.json()["id"])
        duplicate_binding = duplicate.bindings.get()
        duplicate_scene = json.loads(bytes(duplicate.scene_binary))
        target_key = duplicate_scene["elements"][0]["customData"]["nodeKey"]
        assert duplicate.generation == 0
        assert duplicate_binding.node_key == uuid.UUID(target_key)
        assert target_key != source_key
        assert duplicate_scene["elements"][0]["link"] == f"https://work-map.invalid/nodes/{target_key}"
        assert "enabledOrigin" not in duplicate_scene["elements"][1]["customData"]
        assert duplicate_binding.source_kind == "work-item"
        assert duplicate_binding.source_id == issue.id
        assert duplicate.document.owned_by == create_user
        assert duplicate.document.document_projects.filter(project=project, deleted_at__isnull=True).exists()
        replayed = session_client.post(
            duplicate_url,
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY=duplicate_key,
        )
        assert replayed.status_code == status.HTTP_200_OK
        assert replayed.json()["id"] == duplicated.json()["id"]

        source_membership.is_active = False
        source_membership.save(update_fields=["is_active"])
        work_map_count = Document.objects.filter(kind=Document.Kind.WORK_MAP).count()
        inaccessible_source = session_client.post(
            duplicate_url,
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
        )
        assert inaccessible_source.status_code == status.HTTP_409_CONFLICT
        assert Document.objects.filter(kind=Document.Kind.WORK_MAP).count() == work_map_count

    def test_duplicate_requires_write_access_to_every_linked_project(self, session_client, workspace, create_user):
        route_project, _ = _project(workspace, create_user, "DUPA")
        inaccessible_project = Project.objects.create(
            name="Inaccessible project",
            identifier="DUPB",
            workspace=workspace,
        )
        work_map_data = _create_work_map(session_client, workspace, route_project)
        work_map = WorkMap.objects.get(pk=work_map_data["id"])
        DocumentProject.objects.create(
            document=work_map.document,
            project=inaccessible_project,
            workspace=workspace,
        )
        asset = FileAsset.objects.create(
            workspace=workspace,
            document=work_map.document,
            asset="duplicate-source-asset",
            attributes={"name": "source.png", "type": "image/png"},
            entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
            is_uploaded=True,
        )
        work_map.scene_binary = json.dumps(
            {
                "elements": [{"id": "image", "type": "image", "fileId": "file"}],
                "files": {
                    "file": {"assetId": str(asset.id), "mimeType": "image/png", "created": 1},
                },
            }
        ).encode()
        work_map.save(update_fields=["scene_binary"])
        document_count = Document.objects.filter(kind=Document.Kind.WORK_MAP).count()
        asset_count = FileAsset.objects.filter(entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE).count()
        link_count = DocumentProject.objects.count()

        with patch("plane.app.views.work_map.duplicate.S3Storage.copy_object") as copy_object:
            response = session_client.post(
                _work_maps_url(workspace, route_project, work_map.pk, "duplicate/"),
                {},
                format="json",
                HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
            )

        assert response.status_code == status.HTTP_409_CONFLICT
        copy_object.assert_not_called()
        assert Document.objects.filter(kind=Document.Kind.WORK_MAP).count() == document_count
        assert FileAsset.objects.filter(entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE).count() == asset_count
        assert DocumentProject.objects.count() == link_count

    def test_version_restore_replaces_scene_and_bindings_in_one_generation(
        self, session_client, workspace, create_user
    ):
        project, _ = _project(workspace, create_user, "VER")
        state = State.objects.create(
            project=project,
            workspace=workspace,
            name="Backlog",
            color="#000000",
            group="backlog",
            default=True,
        )
        first_issue = Issue.objects.create(project=project, workspace=workspace, state=state, name="First")
        second_issue = Issue.objects.create(project=project, workspace=workspace, state=state, name="Second")
        work_map = _create_work_map(session_client, workspace, project)
        scene_url = _work_maps_url(workspace, project, work_map["id"], "scene/")
        bindings_url = _work_maps_url(workspace, project, work_map["id"], "bindings/")
        versions_url = _work_maps_url(workspace, project, work_map["id"], "versions/")
        first_binding = session_client.post(
            bindings_url,
            {
                "generation": 0,
                "placement_id": uuid.uuid4(),
                "source_kind": "work-item",
                "source_id": first_issue.id,
            },
            format="json",
        ).json()
        first_scene = json.dumps(
            {
                "elements": [
                    {
                        "id": "first",
                        "type": "embeddable",
                        "link": f"https://work-map.invalid/nodes/{first_binding['node_key']}",
                        "customData": {"nodeKey": first_binding["node_key"]},
                    }
                ],
                "files": {},
            }
        ).encode()
        session_client.patch(
            scene_url,
            {
                "generation": 0,
                "scene_binary": base64.b64encode(first_scene).decode("ascii"),
            },
            format="json",
        )
        version = session_client.post(versions_url, {}, format="json")
        assert version.status_code == status.HTTP_201_CREATED, version.json()
        assert version.json()["generation"] == 1
        assert set(session_client.get(versions_url).json()[0]) == {
            "id",
            "work_map",
            "generation",
            "owned_by",
            "created_at",
        }

        asset_scene = b'{"elements":[],"files":{"asset-id":{}}}'
        invalid_asset_scene = session_client.patch(
            scene_url,
            {"generation": 1, "scene_binary": base64.b64encode(asset_scene).decode("ascii")},
            format="json",
        )
        assert invalid_asset_scene.status_code == status.HTTP_409_CONFLICT
        assert WorkMapVersion.objects.filter(document_version__document_id=work_map["id"]).count() == 1

        second_binding = session_client.post(
            bindings_url,
            {
                "generation": 1,
                "placement_id": uuid.uuid4(),
                "source_kind": "work-item",
                "source_id": second_issue.id,
            },
            format="json",
        ).json()
        second_scene = json.dumps(
            {
                "elements": [
                    {
                        "id": "first",
                        "type": "embeddable",
                        "link": f"https://work-map.invalid/nodes/{first_binding['node_key']}",
                        "customData": {"nodeKey": first_binding["node_key"]},
                    },
                    {
                        "id": "second",
                        "type": "embeddable",
                        "link": f"https://work-map.invalid/nodes/{second_binding['node_key']}",
                        "customData": {"nodeKey": second_binding["node_key"]},
                    },
                ],
                "files": {},
            }
        ).encode()
        session_client.patch(
            scene_url,
            {
                "generation": 1,
                "scene_binary": base64.b64encode(second_scene).decode("ascii"),
            },
            format="json",
        )
        restore_url = f"{versions_url}{version.json()['id']}/restore/"
        stale = session_client.post(restore_url, {"generation": 1}, format="json")
        assert stale.status_code == status.HTTP_409_CONFLICT
        assert bytes(WorkMap.objects.get(pk=work_map["id"]).scene_binary) == second_scene
        assert WorkMapBinding.objects.filter(work_map_id=work_map["id"]).count() == 2

        restored = session_client.post(restore_url, {"generation": 2}, format="json")
        current = WorkMap.objects.get(pk=work_map["id"])
        current_binding = current.bindings.get()
        assert restored.status_code == status.HTTP_200_OK
        assert restored.json() == {"generation": 3}
        assert bytes(current.scene_binary) == first_scene
        assert current.generation == 3
        assert current.collaboration_epoch == 1
        assert current_binding.node_key == uuid.UUID(first_binding["node_key"])
        assert current_binding.source_id == first_issue.id
        assert WorkMapVersion.objects.filter(document_version__document=current.document).count() == 1

    def test_work_map_version_retention_hard_deletes_the_oldest_snapshot(self, session_client, workspace, create_user):
        project, _ = _project(workspace, create_user, "RET")
        work_map = _create_work_map(session_client, workspace, project)
        document = Document.objects.get(id=work_map["id"])
        versions_url = _work_maps_url(workspace, project, work_map["id"], "versions/")

        first = session_client.post(versions_url, {}, format="json")
        assert first.status_code == status.HTTP_201_CREATED
        retained_asset = FileAsset.objects.create(
            workspace=workspace,
            document=document,
            asset="retained-version-asset",
            entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
            is_uploaded=True,
        )
        DocumentVersionAsset.objects.create(document_version_id=first.json()["id"], asset=retained_asset)

        for _ in range(20):
            assert session_client.post(versions_url, {}, format="json").status_code == status.HTTP_201_CREATED

        assert WorkMapVersion.objects.filter(document_version__document=document).count() == 20
        assert not DocumentVersion.all_objects.filter(id=first.json()["id"]).exists()
        assert not DocumentVersionAsset.all_objects.filter(document_version_id=first.json()["id"]).exists()
        assert FileAsset.objects.filter(id=retained_asset.id).exists()

    def test_hard_delete_preserves_assets_retained_by_document_versions(self, session_client, workspace, create_user):
        project, _ = _project(workspace, create_user, "HDA")
        work_map = WorkMap.objects.get(pk=_create_work_map(session_client, workspace, project)["id"])
        version = DocumentVersion.objects.create(
            document=work_map.document,
            workspace=workspace,
            owned_by=create_user,
        )
        WorkMapVersion.objects.create(document_version=version, generation=0)
        asset = FileAsset.objects.create(
            workspace=workspace,
            document=work_map.document,
            asset="historical-version-asset",
            entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
            is_uploaded=True,
        )
        edge = DocumentVersionAsset.objects.create(document_version=version, asset=asset)
        FileAsset.objects.filter(id=asset.id).update(
            is_deleted=True,
            deleted_at=timezone.now() - timedelta(days=settings.HARD_DELETE_AFTER_DAYS + 1),
        )

        hard_delete()
        assert FileAsset.all_objects.filter(id=asset.id).exists()
        edge.delete(soft=False)
        hard_delete()
        assert not FileAsset.all_objects.filter(id=asset.id).exists()

    @patch("plane.app.views.asset.work_map.S3Storage.generate_presigned_url", return_value="https://signed.invalid/a")
    @patch("plane.app.views.asset.work_map.S3Storage.get_object_metadata")
    @patch("plane.app.views.asset.work_map.S3Storage.generate_presigned_post")
    def test_work_map_scene_assets_version_and_duplicate_are_one_authorized_lifecycle(
        self,
        generate_presigned_post,
        get_object_metadata,
        generate_presigned_url,
        session_client,
        workspace,
        create_user,
    ):
        generate_presigned_post.return_value = {"url": "https://upload.invalid", "fields": {}}
        get_object_metadata.return_value = {
            "ContentType": "image/png",
            "ContentLength": 4,
            "ETag": "etag",
        }
        project, _ = _project(workspace, create_user, "AST")
        work_map = _create_work_map(session_client, workspace, project)
        assets_url = _work_map_scene_assets_url(workspace, project, work_map["id"])

        asset_ids = []
        for name in ("diagram.png", "overview.png"):
            created = session_client.post(
                assets_url,
                {"name": name, "mime_type": "image/png", "size": 4},
                format="json",
            )
            assert created.status_code == status.HTTP_201_CREATED
            asset_id = created.json()["asset"]["asset_id"]
            asset_ids.append(asset_id)
            assert created.json()["asset"]["is_uploaded"] is False
            finalized = session_client.patch(f"{assets_url}{asset_id}/", {}, format="json")
            assert finalized.status_code == status.HTTP_200_OK
            assert finalized.json()["is_uploaded"] is True

        orphan = session_client.post(
            assets_url,
            {"name": "unused.png", "mime_type": "image/png", "size": 4},
            format="json",
        ).json()["asset"]
        assert session_client.patch(f"{assets_url}{orphan['asset_id']}/", {}, format="json").status_code == 200
        assert FileAsset.objects.get(id=orphan["asset_id"]).project_id is None
        with patch(
            "plane.app.views.asset.work_map.S3Storage.delete_files",
            side_effect=[False, True],
        ) as delete_files:
            assert session_client.delete(f"{assets_url}{orphan['asset_id']}/").status_code == 503
            assert FileAsset.objects.filter(id=orphan["asset_id"]).exists()
            assert session_client.delete(f"{assets_url}{orphan['asset_id']}/").status_code == 204
        assert delete_files.call_count == 2
        assert not FileAsset.objects.filter(id=orphan["asset_id"]).exists()
        assert FileAsset.all_objects.filter(id=orphan["asset_id"], deleted_at__isnull=False).exists()

        pending = session_client.post(
            assets_url,
            {"name": "pending.png", "mime_type": "image/png", "size": 4},
            format="json",
        ).json()["asset"]["asset_id"]
        other_work_map = _create_work_map(session_client, workspace, project)
        other_assets_url = _work_map_scene_assets_url(workspace, project, other_work_map["id"])
        cross_document_asset = session_client.post(
            other_assets_url,
            {"name": "other.png", "mime_type": "image/png", "size": 4},
            format="json",
        ).json()["asset"]["asset_id"]
        assert (
            session_client.patch(f"{other_assets_url}{cross_document_asset}/", {}, format="json").status_code
            == status.HTTP_200_OK
        )

        scene = json.dumps(
            {
                "elements": [
                    {"id": "image-1", "type": "image", "fileId": "file-1"},
                    {"id": "image-2", "type": "image", "fileId": "file-2"},
                ],
                "files": {
                    "file-1": {
                        "assetId": asset_ids[0],
                        "mimeType": "image/png",
                        "created": 1,
                    },
                    "file-2": {
                        "assetId": asset_ids[1],
                        "mimeType": "image/png",
                        "created": 2,
                    },
                },
            }
        ).encode()
        scene_url = _work_maps_url(workspace, project, work_map["id"], "scene/")
        asset_count_before_rejections = FileAsset.objects.count()
        for unavailable_asset_id in (pending, cross_document_asset, str(uuid.uuid4())):
            unavailable_scene = json.loads(scene)
            unavailable_scene["files"]["file-1"]["assetId"] = unavailable_asset_id
            rejected_asset = session_client.patch(
                scene_url,
                {
                    "generation": 0,
                    "scene_binary": base64.b64encode(json.dumps(unavailable_scene).encode()).decode("ascii"),
                },
                format="json",
            )
            assert rejected_asset.status_code == status.HTTP_409_CONFLICT
            assert WorkMap.objects.get(pk=work_map["id"]).generation == 0
            assert FileAsset.objects.count() == asset_count_before_rejections

        leaked_file_metadata = json.loads(scene)
        leaked_file_metadata["files"]["file-1"]["dataURL"] = "data:image/png;base64,AAAA"
        rejected_leak = session_client.patch(
            scene_url,
            {
                "generation": 0,
                "scene_binary": base64.b64encode(json.dumps(leaked_file_metadata).encode()).decode("ascii"),
            },
            format="json",
        )
        assert rejected_leak.status_code == status.HTTP_409_CONFLICT
        saved = session_client.patch(
            scene_url,
            {"generation": 0, "scene_binary": base64.b64encode(scene).decode("ascii")},
            format="json",
        )
        assert saved.status_code == status.HTTP_200_OK
        assert session_client.delete(f"{assets_url}{asset_ids[0]}/").status_code == status.HTTP_409_CONFLICT

        materialized = session_client.get(f"{assets_url}{asset_ids[0]}/")
        assert materialized.status_code == status.HTTP_302_FOUND
        assert materialized.url == "https://signed.invalid/a"
        generate_presigned_url.assert_called_once()
        other_project, _ = _project(workspace, create_user, "NOA")
        denied_materialization = session_client.get(
            _work_map_scene_assets_url(workspace, other_project, work_map["id"], asset_ids[0])
        )
        assert denied_materialization.status_code == status.HTTP_404_NOT_FOUND
        assert (
            session_client.get(f"/api/assets/v2/workspaces/{workspace.slug}/download/{asset_ids[0]}/").status_code
            == status.HTTP_404_NOT_FOUND
        )

        versions_url = _work_maps_url(workspace, project, work_map["id"], "versions/")
        version = session_client.post(versions_url, {}, format="json")
        assert version.status_code == status.HTTP_201_CREATED
        assert set(
            DocumentVersionAsset.objects.filter(
                document_version_id=version.json()["id"],
            ).values_list("asset_id", flat=True)
        ) == {uuid.UUID(asset_id) for asset_id in asset_ids}

        deploy_board = DeployBoard.objects.create(
            entity_name="project",
            entity_identifier=project.id,
            project=project,
            workspace=workspace,
        )
        generic_asset_url = f"/api/workspaces/{workspace.slug}/assets/{asset_ids[0]}/"
        public_asset_url = f"/api/public/assets/v2/anchor/{deploy_board.anchor}/{asset_ids[0]}/"
        assert session_client.get(generic_asset_url).status_code == status.HTTP_404_NOT_FOUND
        assert session_client.patch(generic_asset_url, {}, format="json").status_code == status.HTTP_404_NOT_FOUND
        assert session_client.get(public_asset_url).status_code == status.HTTP_404_NOT_FOUND
        assert session_client.patch(public_asset_url, {}, format="json").status_code == status.HTTP_404_NOT_FOUND
        assert session_client.delete(public_asset_url).status_code == status.HTTP_404_NOT_FOUND
        assert FileAsset.objects.filter(id=asset_ids[0], is_uploaded=True).exists()
        assert DocumentVersionAsset.objects.filter(
            document_version_id=version.json()["id"], asset_id=asset_ids[0]
        ).exists()

        paste_target = _create_work_map(session_client, workspace, project)
        paste_idempotency_key = uuid.uuid4()
        paste_url = _work_maps_url(workspace, project, paste_target["id"], "paste-rebindings/")
        with (
            patch(
                "plane.app.views.work_map.paste.S3Storage.copy_object",
                side_effect=[{"ok": True}, None],
            ),
            patch("plane.app.views.work_map.paste.S3Storage.delete_files", return_value=True) as paste_cleanup,
        ):
            failed_paste = session_client.post(
                paste_url,
                {
                    "generation": 0,
                    "idempotency_key": paste_idempotency_key,
                    "node_keys": [],
                    "files": [
                        {"file_id": "file-1", "asset_id": asset_ids[0]},
                        {"file_id": "file-2", "asset_id": asset_ids[1]},
                    ],
                },
                format="json",
            )
        assert failed_paste.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
        paste_receipt = WorkMapPasteRebinding.all_objects.get(
            work_map_id=paste_target["id"],
            idempotency_key=paste_idempotency_key,
        )
        assert paste_receipt.status == WorkMapPasteRebinding.Status.FAILED
        assert paste_receipt.deleted_at is not None
        assert paste_receipt.lease_id is None
        assert paste_receipt.lease_expires_at is None
        assert not FileAsset.objects.filter(document_id=paste_target["id"]).exists()
        paste_cleanup.assert_called_once()
        assert len(paste_cleanup.call_args.args[0]) == 2

        duplicate_url = _work_maps_url(workspace, project, work_map["id"], "duplicate/")
        duplicate_idempotency_key = uuid.uuid4()
        with (
            patch("plane.app.views.work_map.duplicate.S3Storage.copy_object", return_value={"ok": True}),
            patch(
                "plane.app.views.work_map.duplicate.renew_copy_lease",
                wraps=renew_duplicate_lease,
            ) as renew_lease,
        ):
            duplicated = session_client.post(
                duplicate_url,
                {},
                format="json",
                HTTP_IDEMPOTENCY_KEY=str(duplicate_idempotency_key),
            )
        assert duplicated.status_code == status.HTTP_201_CREATED
        duplicate_receipt = WorkMapDuplicateOperation.all_objects.get(idempotency_key=duplicate_idempotency_key)
        assert duplicate_receipt.status == WorkMapDuplicateOperation.Status.COMMITTED
        assert duplicate_receipt.deleted_at is not None
        assert renew_lease.call_count == 4
        duplicate_scene = json.loads(bytes(WorkMap.objects.get(pk=duplicated.json()["id"]).scene_binary))
        duplicate_asset_ids = {metadata["assetId"] for metadata in duplicate_scene["files"].values()}
        assert duplicate_asset_ids.isdisjoint(asset_ids)
        assert (
            FileAsset.objects.filter(
                id__in=duplicate_asset_ids,
                document_id=duplicated.json()["id"],
                is_uploaded=True,
            ).count()
            == 2
        )

        document_count = Document.objects.filter(kind=Document.Kind.WORK_MAP).count()
        asset_count = FileAsset.objects.filter(entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE).count()
        failed_duplicate_idempotency_key = uuid.uuid4()
        with (
            patch(
                "plane.app.views.work_map.duplicate.S3Storage.copy_object",
                side_effect=[{"ok": True}, None],
            ),
            patch("plane.app.views.work_map.duplicate.S3Storage.delete_files", return_value=True) as delete_files,
        ):
            failed_duplicate = session_client.post(
                duplicate_url,
                {},
                format="json",
                HTTP_IDEMPOTENCY_KEY=str(failed_duplicate_idempotency_key),
            )
        assert failed_duplicate.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
        failed_duplicate_receipt = WorkMapDuplicateOperation.all_objects.get(
            idempotency_key=failed_duplicate_idempotency_key
        )
        assert failed_duplicate_receipt.status == WorkMapDuplicateOperation.Status.FAILED
        assert failed_duplicate_receipt.deleted_at is not None
        assert Document.objects.filter(kind=Document.Kind.WORK_MAP).count() == document_count
        assert FileAsset.objects.filter(entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE).count() == asset_count
        delete_files.assert_called_once()
        assert len(delete_files.call_args.args[0]) == 2

    def test_work_map_uses_existing_favorite_recent_and_search_surfaces(self, session_client, workspace, create_user):
        project, membership = _project(workspace, create_user, "DSC")
        linked_project, _ = _project(workspace, create_user, "LNK")
        work_map = _create_work_map(session_client, workspace, project)
        DocumentProject.objects.create(
            document_id=work_map["id"],
            project=linked_project,
            workspace=workspace,
        )
        inaccessible_project = Project.objects.create(
            name="Inaccessible project",
            identifier="HID",
            workspace=workspace,
        )
        DocumentProject.objects.create(
            document_id=work_map["id"],
            project=inaccessible_project,
            workspace=workspace,
        )
        favorite_url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/favorite-work-maps/{work_map['id']}/"

        assert session_client.post(favorite_url).status_code == status.HTTP_204_NO_CONTENT
        linked_favorite_url = (
            f"/api/workspaces/{workspace.slug}/projects/{linked_project.id}/favorite-work-maps/{work_map['id']}/"
        )
        assert session_client.get(_work_maps_url(workspace, linked_project)).json()[0]["is_favorite"] is True
        assert session_client.post(linked_favorite_url).status_code == status.HTTP_204_NO_CONTENT
        listed = session_client.get(_work_maps_url(workspace, project)).json()
        assert listed[0]["is_favorite"] is True
        favorites = session_client.get(f"/api/workspaces/{workspace.slug}/user-favorites/").json()
        favorite = next(item for item in favorites if item["entity_type"] == "work_map")
        assert favorite["entity_data"]["id"] == work_map["id"]
        assert favorite["entity_data"]["name"] == "Planning map"
        assert favorite["entity_data"]["project_id"] in {str(project.id), str(linked_project.id)}

        search = session_client.get(
            f"/api/workspaces/{workspace.slug}/search/",
            {"search": "Planning", "entities": "work_map", "project_id": project.id},
        )
        assert search.status_code == status.HTTP_200_OK
        search_result = list(search.json()["results"]["work_map"])[0]
        assert search_result["id"] == work_map["id"]
        assert set(search_result["project_ids"]) == {str(project.id), str(linked_project.id)}
        assert set(search_result["project_identifiers"]) == {project.identifier, linked_project.identifier}

        UserRecentVisit.objects.create(
            workspace=workspace,
            project=project,
            user=create_user,
            entity_name="work_map",
            entity_identifier=work_map["id"],
        )
        recents = session_client.get(
            f"/api/workspaces/{workspace.slug}/recent-visits/",
            {"entity_name": "work_map"},
        )
        assert recents.status_code == status.HTTP_200_OK
        assert recents.json()[0]["entity_data"]["id"] == work_map["id"]
        assert recents.json()[0]["entity_data"]["project_id"] == str(project.id)
        assert recents.json()[0]["entity_data"]["project_identifier"] == project.identifier

        assert session_client.delete(linked_favorite_url).status_code == status.HTTP_204_NO_CONTENT
        assert session_client.get(_work_maps_url(workspace, project)).json()[0]["is_favorite"] is False

        membership.is_active = False
        membership.save(update_fields=["is_active"])
        denied_recent = session_client.get(
            f"/api/workspaces/{workspace.slug}/recent-visits/",
            {"entity_name": "work_map"},
        )
        assert denied_recent.json()[0]["entity_data"] is None

    def test_source_discovery_hydration_and_open_reauthorize_all_six_kinds(
        self, session_client, workspace, create_user
    ):
        map_project, _ = _project(workspace, create_user, "MAPSRC")
        source_project, source_membership = _project(workspace, create_user, "SOURCE")
        records = _source_records(workspace, source_project, create_user)
        work_map = _create_work_map(session_client, workspace, map_project)
        base = _work_maps_url(workspace, map_project, work_map["id"])

        for source_kind, source in records.items():
            discovered = session_client.get(
                f"{base}sources/",
                {
                    "source_kind": source_kind,
                    "query": source.issue.name if source_kind == "intake-item" else source.name,
                },
            )
            assert discovered.status_code == status.HTTP_200_OK
            assert [result["source_id"] for result in discovered.json()["results"]] == [str(source.id)]
            bound = session_client.post(
                f"{base}bindings/",
                {
                    "generation": 0,
                    "placement_id": uuid.uuid4(),
                    "source_kind": source_kind,
                    "source_id": source.id,
                },
                format="json",
            )
            assert bound.status_code == status.HTTP_201_CREATED

        bindings = list(WorkMapBinding.objects.filter(work_map_id=work_map["id"]).order_by("created_at"))
        node_keys = [str(binding.node_key) for binding in bindings]
        hydrated = session_client.post(f"{base}bindings/hydrate/", {"node_keys": node_keys}, format="json")
        assert hydrated.status_code == status.HTTP_200_OK
        assert [result["node_key"] for result in hydrated.json()["results"]] == node_keys
        assert {result["source"]["source_kind"] for result in hydrated.json()["results"]} == set(records)

        source_membership.is_active = False
        source_membership.save(update_fields=["is_active"])
        denied = session_client.post(f"{base}bindings/hydrate/", {"node_keys": node_keys}, format="json")
        assert denied.json()["results"] == [{"node_key": node_key, "available": False} for node_key in node_keys]

        opened = session_client.post(f"{base}bindings/open/", {"node_key": node_keys[0]}, format="json")
        assert opened.json() == {"node_key": node_keys[0], "available": False}
