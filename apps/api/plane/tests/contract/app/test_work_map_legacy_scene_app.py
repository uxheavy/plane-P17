# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file in the repository root for details.

import base64
import uuid

import pytest
from rest_framework import status

from plane.db.models import (
    Document,
    FileAsset,
    Issue,
    Project,
    ProjectMember,
    State,
    WorkMap,
    WorkMapBinding,
    WorkMapBindingPlacement,
    WorkMapPasteRebinding,
    WorkMapVersion,
)


def _project(workspace, user):
    project = Project.objects.create(
        name="Legacy scene project",
        identifier="LSC",
        workspace=workspace,
        cycle_view=True,
        module_view=True,
        issue_views_view=True,
        page_view=True,
        intake_view=True,
    )
    ProjectMember.objects.create(workspace=workspace, project=project, member=user, role=20, is_active=True)
    return project


def _work_map_url(workspace, project, work_map_id, suffix=""):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/work-maps/{work_map_id}/{suffix}"


def _create_work_map(client, workspace, project):
    response = client.post(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/work-maps/",
        {"name": "Legacy scene map"},
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED
    return response.json()


def _set_legacy_scene(work_map, scene=b"\x00excalidraw\xffscene"):
    work_map.scene_binary = scene
    work_map.generation = 0
    work_map.save(update_fields=["scene_binary", "generation"])
    return scene


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkMapLegacySceneApp:
    def test_opaque_scene_preserves_the_pre_lifecycle_scene_contract(self, session_client, workspace, create_user):
        project = _project(workspace, create_user)
        work_map_data = _create_work_map(session_client, workspace, project)
        work_map = WorkMap.objects.get(pk=work_map_data["id"])
        legacy_scene = _set_legacy_scene(work_map)
        scene_url = _work_map_url(workspace, project, work_map.pk, "scene/")

        current = session_client.get(scene_url)
        updated_scene = b"legacy scene update\xff"
        updated = session_client.patch(
            scene_url,
            {
                "collaboration_epoch": 0,
                "generation": 0,
                "scene_binary": base64.b64encode(updated_scene).decode("ascii"),
            },
            format="json",
        )
        retry = session_client.patch(
            scene_url,
            {
                "collaboration_epoch": 0,
                "generation": 0,
                "scene_binary": base64.b64encode(updated_scene).decode("ascii"),
            },
            format="json",
        )

        assert current.status_code == status.HTTP_200_OK
        assert current.json() == {
            "collaboration_epoch": 0,
            "generation": 0,
            "scene_binary": base64.b64encode(legacy_scene).decode("ascii"),
        }
        assert updated.status_code == status.HTTP_200_OK
        assert updated.json() == {"generation": 1}
        assert retry.status_code == status.HTTP_200_OK
        assert retry.json() == {"generation": 1}
        work_map.refresh_from_db()
        assert bytes(work_map.scene_binary) == updated_scene
        assert work_map.generation == 1

    def test_structured_scene_rejects_opaque_overwrite(self, session_client, workspace, create_user):
        project = _project(workspace, create_user)
        work_map_data = _create_work_map(session_client, workspace, project)
        work_map = WorkMap.objects.get(pk=work_map_data["id"])
        scene_url = _work_map_url(workspace, project, work_map.pk, "scene/")
        structured_scene = b'{"elements":[],"files":{}}'

        updated = session_client.patch(
            scene_url,
            {
                "collaboration_epoch": 0,
                "generation": 0,
                "scene_binary": base64.b64encode(structured_scene).decode("ascii"),
            },
            format="json",
        )
        rejected = session_client.patch(
            scene_url,
            {
                "collaboration_epoch": 0,
                "generation": 1,
                "scene_binary": base64.b64encode(b"legacy scene").decode("ascii"),
            },
            format="json",
        )

        assert updated.status_code == status.HTTP_200_OK
        assert rejected.status_code == status.HTTP_409_CONFLICT
        assert rejected.json() == {"error": "Work map scene requires upgrade"}
        work_map.refresh_from_db()
        assert bytes(work_map.scene_binary) == structured_scene
        assert work_map.generation == 1

    def test_opaque_scene_version_snapshot_and_restore_preserve_exact_bytes(
        self, session_client, workspace, create_user
    ):
        project = _project(workspace, create_user)
        work_map_data = _create_work_map(session_client, workspace, project)
        work_map = WorkMap.objects.get(pk=work_map_data["id"])
        legacy_scene = _set_legacy_scene(work_map)
        versions_url = _work_map_url(workspace, project, work_map.pk, "versions/")
        scene_url = _work_map_url(workspace, project, work_map.pk, "scene/")

        created = session_client.post(versions_url, {}, format="json")
        changed_scene = b"another opaque scene\x00"
        changed = session_client.patch(
            scene_url,
            {
                "collaboration_epoch": 0,
                "generation": 0,
                "scene_binary": base64.b64encode(changed_scene).decode("ascii"),
            },
            format="json",
        )
        restored = session_client.post(
            f"{versions_url}{created.json()['id']}/restore/",
            {"generation": 1},
            format="json",
        )

        assert created.status_code == status.HTTP_201_CREATED
        assert changed.status_code == status.HTTP_200_OK
        assert restored.status_code == status.HTTP_200_OK
        version = WorkMapVersion.objects.get(pk=created.json()["id"])
        assert bytes(version.scene_binary) == legacy_scene
        work_map.refresh_from_db()
        assert bytes(work_map.scene_binary) == legacy_scene
        assert work_map.generation == 2
        assert work_map.collaboration_epoch == 1

    def test_opaque_scene_without_semantic_references_duplicates_exact_bytes(
        self, session_client, workspace, create_user
    ):
        project = _project(workspace, create_user)
        work_map_data = _create_work_map(session_client, workspace, project)
        work_map = WorkMap.objects.get(pk=work_map_data["id"])
        legacy_scene = _set_legacy_scene(work_map)

        duplicate = session_client.post(
            _work_map_url(workspace, project, work_map.pk, "duplicate/"),
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
        )

        assert duplicate.status_code == status.HTTP_201_CREATED
        duplicated = WorkMap.objects.get(pk=duplicate.json()["id"])
        assert bytes(duplicated.scene_binary) == legacy_scene
        assert not duplicated.bindings.filter(deleted_at__isnull=True).exists()

    def test_opaque_scene_semantic_operations_fail_before_side_effects(self, session_client, workspace, create_user):
        project = _project(workspace, create_user)
        work_map_data = _create_work_map(session_client, workspace, project)
        work_map = WorkMap.objects.get(pk=work_map_data["id"])
        legacy_scene = _set_legacy_scene(work_map)
        state = State.objects.create(
            project=project,
            workspace=workspace,
            name="Backlog",
            color="#000000",
            group="backlog",
            default=True,
        )
        issue = Issue.objects.create(project=project, workspace=workspace, state=state, name="Work item")
        binding_url = _work_map_url(workspace, project, work_map.pk, "bindings/")
        new_binding = session_client.post(
            binding_url,
            {
                "generation": 0,
                "placement_id": uuid.uuid4(),
                "source_kind": "work-item",
                "source_id": issue.id,
            },
            format="json",
        )
        assert new_binding.status_code == status.HTTP_409_CONFLICT
        assert new_binding.json() == {"error": "Work map scene requires upgrade"}
        assert not WorkMapBinding.objects.filter(work_map=work_map).exists()
        binding = WorkMapBinding.objects.create(
            work_map=work_map,
            node_key=uuid.uuid4(),
            source_kind=WorkMapBinding.SourceKind.WORK_ITEM,
            source_id=uuid.uuid4(),
            created_by=create_user,
        )
        placement = WorkMapBindingPlacement.objects.create(
            work_map=work_map,
            binding=binding,
            placement_id=uuid.uuid4(),
        )
        WorkMapBindingPlacement.all_objects.filter(pk=placement.pk).update(created_by_id=create_user.id)
        versions_url = _work_map_url(workspace, project, work_map.pk, "versions/")
        duplicate_url = _work_map_url(workspace, project, work_map.pk, "duplicate/")
        paste_url = _work_map_url(workspace, project, work_map.pk, "paste-rebindings/")

        version = session_client.post(versions_url, {}, format="json")
        duplicate = session_client.post(
            duplicate_url,
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
        )
        paste = session_client.post(
            paste_url,
            {
                "generation": 0,
                "node_keys": [str(binding.node_key)],
                "files": [],
                "idempotency_key": str(uuid.uuid4()),
            },
            format="json",
        )
        cancel_url = _work_map_url(workspace, project, work_map.pk, f"binding-placements/{placement.placement_id}/")
        cancelled = session_client.delete(f"{cancel_url}?generation=0")

        for response in (version, duplicate, paste, cancelled):
            assert response.status_code == status.HTTP_409_CONFLICT
            assert response.json() == {"error": "Work map scene requires upgrade"}
        assert Document.objects.filter(kind=Document.Kind.WORK_MAP).count() == 1
        assert WorkMapVersion.objects.filter(document_version__document=work_map.document).count() == 0
        assert not WorkMapPasteRebinding.objects.filter(work_map=work_map).exists()
        assert WorkMapBinding.objects.filter(pk=binding.pk, deleted_at__isnull=True).exists()
        assert WorkMapBindingPlacement.objects.filter(pk=placement.pk, deleted_at__isnull=True).exists()
        assert bytes(WorkMap.objects.get(pk=work_map.pk).scene_binary) == legacy_scene

    def test_opaque_scene_asset_delete_fails_closed_without_mutation(self, session_client, workspace, create_user):
        project = _project(workspace, create_user)
        work_map_data = _create_work_map(session_client, workspace, project)
        work_map = WorkMap.objects.get(pk=work_map_data["id"])
        _set_legacy_scene(work_map)
        asset = FileAsset.objects.create(
            attributes={"name": "legacy.png", "type": "image/png", "size": 4},
            asset="legacy-scene-asset",
            size=4,
            workspace=workspace,
            document=work_map.document,
            entity_type=FileAsset.EntityTypeContext.WORK_MAP_SCENE,
            is_uploaded=True,
            created_by=create_user,
        )
        asset_url = (
            f"/api/assets/v2/workspaces/{workspace.slug}/projects/{project.id}/work-maps/{work_map.pk}/scene-assets/"
            f"{asset.pk}/"
        )

        response = session_client.delete(asset_url)

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.json() == {"error": "Work map scene requires upgrade"}
        assert FileAsset.objects.filter(pk=asset.pk, deleted_at__isnull=True).exists()

    def test_opaque_scene_rejects_new_asset_uploads(self, session_client, workspace, create_user):
        project = _project(workspace, create_user)
        work_map_data = _create_work_map(session_client, workspace, project)
        work_map = WorkMap.objects.get(pk=work_map_data["id"])
        _set_legacy_scene(work_map)
        asset_url = (
            f"/api/assets/v2/workspaces/{workspace.slug}/projects/{project.id}/work-maps/{work_map.pk}/scene-assets/"
        )

        response = session_client.post(
            asset_url,
            {"name": "new.png", "mime_type": "image/png", "size": 4},
            format="json",
        )

        assert response.status_code == status.HTTP_409_CONFLICT
        assert response.json() == {"error": "Work map scene requires upgrade"}
        assert not FileAsset.objects.filter(document=work_map.document).exists()


# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
