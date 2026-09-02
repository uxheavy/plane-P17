# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file in the repository root for details.

import base64
import json
from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.db import transaction
from django.db.models.deletion import SET_NULL
from django.utils import timezone
from rest_framework import status

from plane.bgtasks.work_map_asset_task import cleanup_stale_scene_asset_placements
from plane.db.models import FileAsset, Page, Project, ProjectMember, WorkMap, WorkMapSceneAssetPlacement


def _project(workspace, user):
    project = Project.objects.create(
        name="Asset placement project",
        identifier="SAP",
        workspace=workspace,
        cycle_view=True,
        module_view=True,
        issue_views_view=True,
        page_view=True,
        intake_view=True,
    )
    ProjectMember.objects.create(workspace=workspace, project=project, member=user, role=20, is_active=True)
    return project


def _work_map_url(workspace, project, work_map_id=None, suffix=""):
    base = f"/api/workspaces/{workspace.slug}/projects/{project.id}/work-maps/"
    return f"{base}{work_map_id}/{suffix}" if work_map_id else base


def _scene_asset_url(workspace, project, work_map_id, asset_id=None):
    base = f"/api/assets/v2/workspaces/{workspace.slug}/projects/{project.id}/work-maps/{work_map_id}/scene-assets/"
    return f"{base}{asset_id}/" if asset_id else base


def _create_scene_asset(session_client, workspace, project, work_map_id, name="asset.png"):
    asset_url = _scene_asset_url(workspace, project, work_map_id)
    created = session_client.post(
        asset_url,
        {"name": name, "mime_type": "image/png", "size": 4},
        format="json",
    )
    assert created.status_code == status.HTTP_201_CREATED
    asset_id = created.json()["asset"]["asset_id"]
    finalized = session_client.patch(f"{asset_url}{asset_id}/", {}, format="json")
    assert finalized.status_code == status.HTTP_200_OK
    return asset_id


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkMapSceneAssetPlacement:
    def test_legacy_page_relation_no_longer_cascades(self, workspace, create_user):
        page = Page.objects.create(workspace=workspace, owned_by=create_user, name="Legacy page")
        asset = FileAsset.objects.create(
            workspace=workspace,
            page=page,
            asset="legacy-page-link",
            entity_type=FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
            is_uploaded=True,
        )

        assert FileAsset._meta.get_field("page").remote_field.on_delete is SET_NULL
        page.delete(soft=False)

        asset.refresh_from_db()
        assert asset.page_id is None

    @patch("plane.app.views.asset.work_map.S3Storage.generate_presigned_post")
    @patch("plane.app.views.asset.work_map.S3Storage.get_object_metadata")
    def test_expired_unreferenced_finalized_upload_is_reclaimed(
        self,
        get_object_metadata,
        generate_presigned_post,
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
        project = _project(workspace, create_user)
        work_map_data = session_client.post(_work_map_url(workspace, project), {"name": "Map"}, format="json").json()
        asset_id = _create_scene_asset(session_client, workspace, project, work_map_data["id"])
        placement = WorkMapSceneAssetPlacement.objects.get(asset_id=asset_id)
        object_name = FileAsset.objects.get(pk=asset_id).asset.name
        WorkMapSceneAssetPlacement.all_objects.filter(pk=placement.pk).update(
            created_at=timezone.now() - timedelta(minutes=16),
        )

        atomic_depth = 0
        real_atomic = transaction.atomic

        @contextmanager
        def tracked_atomic(*args, **kwargs):
            nonlocal atomic_depth
            atomic_depth += 1
            try:
                with real_atomic(*args, **kwargs):
                    yield
            finally:
                atomic_depth -= 1

        def delete_files(object_names):
            assert atomic_depth == 0
            return True

        with (
            patch("plane.bgtasks.work_map_asset_task.transaction.atomic", tracked_atomic),
            patch("plane.bgtasks.work_map_asset_task.S3Storage.delete_files", side_effect=delete_files) as delete_mock,
        ):
            cleanup_stale_scene_asset_placements()

        delete_mock.assert_called_once_with([object_name])
        assert not FileAsset.all_objects.filter(pk=asset_id).exists()
        assert not WorkMapSceneAssetPlacement.all_objects.filter(pk=placement.pk).exists()

    @patch("plane.app.views.asset.work_map.S3Storage.generate_presigned_post")
    @patch("plane.app.views.asset.work_map.S3Storage.get_object_metadata")
    def test_expired_scene_referenced_upload_is_not_reclaimed(
        self,
        get_object_metadata,
        generate_presigned_post,
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
        project = _project(workspace, create_user)
        work_map_data = session_client.post(_work_map_url(workspace, project), {"name": "Map"}, format="json").json()
        asset_id = _create_scene_asset(session_client, workspace, project, work_map_data["id"])
        placement = WorkMapSceneAssetPlacement.objects.get(asset_id=asset_id)
        scene = {
            "elements": [{"id": "image", "type": "image", "fileId": "file"}],
            "files": {
                "file": {
                    "assetId": asset_id,
                    "mimeType": "image/png",
                    "created": 1,
                }
            },
        }
        saved = session_client.patch(
            _work_map_url(workspace, project, work_map_data["id"], "scene/"),
            {
                "generation": 0,
                "scene_binary": base64.b64encode(json.dumps(scene).encode()).decode("ascii"),
            },
            format="json",
        )
        assert saved.status_code == status.HTTP_200_OK
        assert not WorkMapSceneAssetPlacement.all_objects.filter(pk=placement.pk).exists()
        stale_placement = WorkMapSceneAssetPlacement.all_objects.create(
            work_map_id=work_map_data["id"],
            asset_id=asset_id,
        )
        WorkMapSceneAssetPlacement.all_objects.filter(pk=stale_placement.pk).update(
            created_at=timezone.now() - timedelta(minutes=16),
        )

        with patch("plane.bgtasks.work_map_asset_task.S3Storage.delete_files") as delete_files:
            cleanup_stale_scene_asset_placements()

        delete_files.assert_not_called()
        assert FileAsset.objects.filter(pk=asset_id, is_uploaded=True).exists()
        assert not WorkMapSceneAssetPlacement.all_objects.filter(pk=stale_placement.pk).exists()
        assert WorkMap.objects.get(pk=work_map_data["id"]).scene_binary

    @patch("plane.app.views.asset.work_map.S3Storage.generate_presigned_post")
    @patch("plane.app.views.asset.work_map.S3Storage.get_object_metadata")
    def test_durably_deleted_image_can_release_its_file_metadata_and_asset(
        self,
        get_object_metadata,
        generate_presigned_post,
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
        project = _project(workspace, create_user)
        work_map_data = session_client.post(_work_map_url(workspace, project), {"name": "Map"}, format="json").json()
        asset_id = _create_scene_asset(session_client, workspace, project, work_map_data["id"])
        image = {"id": "image", "type": "image", "fileId": "file"}
        files = {"file": {"assetId": asset_id, "mimeType": "image/png", "created": 1}}
        scene_url = _work_map_url(workspace, project, work_map_data["id"], "scene/")

        inserted = session_client.patch(
            scene_url,
            {
                "generation": 0,
                "scene_binary": base64.b64encode(json.dumps({"elements": [image], "files": files}).encode()).decode(
                    "ascii"
                ),
            },
            format="json",
        )
        assert inserted.status_code == status.HTTP_200_OK

        tombstoned = session_client.patch(
            scene_url,
            {
                "generation": 1,
                "scene_binary": base64.b64encode(
                    json.dumps({"elements": [{**image, "isDeleted": True}], "files": files}).encode()
                ).decode("ascii"),
            },
            format="json",
        )
        assert tombstoned.status_code == status.HTTP_200_OK

        metadata_released = session_client.patch(
            scene_url,
            {
                "generation": 2,
                "scene_binary": base64.b64encode(
                    json.dumps({"elements": [{**image, "isDeleted": True}], "files": {}}).encode()
                ).decode("ascii"),
            },
            format="json",
        )
        assert metadata_released.status_code == status.HTTP_200_OK

        with patch("plane.app.views.asset.work_map.S3Storage.delete_files", return_value=True) as delete_files:
            deleted = session_client.delete(_scene_asset_url(workspace, project, work_map_data["id"], asset_id))

        assert deleted.status_code == status.HTTP_204_NO_CONTENT
        delete_files.assert_called_once()
        assert not FileAsset.objects.filter(id=asset_id).exists()
        persisted = json.loads(bytes(WorkMap.objects.get(pk=work_map_data["id"]).scene_binary))
        assert persisted == {"elements": [{**image, "isDeleted": True}], "files": {}}


# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
