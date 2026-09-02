# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import IntegrityError, transaction
from django.utils import timezone
import uuid
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.permissions.work_map import can_read_work_map_source
from plane.app.serializers import WorkMapBindingCancelSerializer, WorkMapBindingCreateSerializer
from plane.db.models import Document, WorkMap, WorkMapBinding, WorkMapBindingPlacement

from ..base import BaseAPIView
from .base import visible_work_maps


WORK_MAP_NODE_LINK_PREFIX = "https://work-map.invalid/nodes/"
PROTECTED_SOURCE_FIELDS = {"sourceId", "sourceKind", "source_id", "source_kind"}


def protected_binding_keys(scene):
    carrier_keys = set()
    for element in scene["elements"]:
        if not isinstance(element, dict):
            raise ValueError("Scene element is invalid")
        custom_data = element.get("customData")
        node_key_value = custom_data.get("nodeKey") if isinstance(custom_data, dict) else None
        link = element.get("link")
        has_node_link = isinstance(link, str) and link.startswith(WORK_MAP_NODE_LINK_PREFIX)
        if node_key_value is None:
            if has_node_link:
                raise ValueError("Plane carrier has no protected binding key")
            continue
        if set(custom_data) != {"nodeKey"}:
            raise ValueError("Plane carrier contains protected source metadata")
        if PROTECTED_SOURCE_FIELDS.intersection(element):
            raise ValueError("Plane carrier contains protected source metadata")
        if element.get("type") != "embeddable" or not has_node_link:
            raise ValueError("Protected binding key is outside a Plane carrier")
        try:
            node_key = uuid.UUID(str(node_key_value))
        except ValueError:
            raise ValueError("Plane carrier binding key is invalid")
        if link != f"{WORK_MAP_NODE_LINK_PREFIX}{node_key}":
            raise ValueError("Plane carrier binding link is invalid")
        carrier_keys.add(node_key)
    return carrier_keys


def validate_protected_binding_carriers(scene, bindings, *, require_every_binding=True):
    binding_keys = set(bindings)
    carrier_keys = protected_binding_keys(scene)
    if not carrier_keys.issubset(binding_keys):
        raise ValueError("Plane carrier binding is unavailable")
    if require_every_binding and carrier_keys != binding_keys:
        raise ValueError("Protected binding has no live Plane carrier")
    return carrier_keys


class WorkMapBindingEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, work_map_id):
        serializer = WorkMapBindingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            with transaction.atomic():
                visible_id = (
                    visible_work_maps(user=request.user, slug=slug, project_id=project_id)
                    .filter(id=work_map_id)
                    .values_list("id", flat=True)
                    .first()
                )
                document = Document.objects.select_for_update().filter(id=visible_id).first()
                if document is None:
                    return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
                if document.is_locked or document.archived_at is not None:
                    return Response({"error": "Work map is not editable"}, status=status.HTTP_409_CONFLICT)
                work_map = WorkMap.objects.select_for_update().get(pk=document.id)
                if data["generation"] != work_map.generation:
                    return Response(
                        {"error": "Work map generation is stale", "generation": work_map.generation},
                        status=status.HTTP_409_CONFLICT,
                    )
                if not can_read_work_map_source(
                    user=request.user,
                    workspace_id=document.workspace_id,
                    source_kind=data["source_kind"],
                    source_id=data["source_id"],
                ):
                    return Response({"error": "Source unavailable"}, status=status.HTTP_404_NOT_FOUND)
                placement = (
                    WorkMapBindingPlacement.all_objects.select_for_update()
                    .filter(
                        work_map=work_map,
                        created_by=request.user,
                        placement_id=data["placement_id"],
                    )
                    .select_related("binding")
                    .first()
                )
                if placement is not None:
                    if (
                        placement.binding.source_kind != data["source_kind"]
                        or placement.binding.source_id != data["source_id"]
                    ):
                        return Response(
                            {"error": "Placement identifier was already used"},
                            status=status.HTTP_409_CONFLICT,
                        )
                    if placement.deleted_at is not None:
                        return Response(
                            {"error": "Placement was cancelled"},
                            status=status.HTTP_409_CONFLICT,
                        )
                    return Response(
                        {
                            "placement_id": placement.placement_id,
                            "node_key": placement.binding.node_key,
                            "revision": placement.binding.revision,
                            "generation": work_map.generation,
                        },
                        status=status.HTTP_200_OK,
                    )

                binding = (
                    WorkMapBinding.all_objects.select_for_update()
                    .filter(
                        work_map=work_map,
                        source_kind=data["source_kind"],
                        source_id=data["source_id"],
                    )
                    .order_by("-created_at")
                    .first()
                )
                if binding is None:
                    binding = WorkMapBinding.objects.create(
                        work_map=work_map,
                        source_kind=data["source_kind"],
                        source_id=data["source_id"],
                        node_key=uuid.uuid4(),
                        created_by=request.user,
                    )
                elif binding.deleted_at is not None:
                    binding.deleted_at = None
                    binding.updated_by = request.user
                    binding.save(update_fields=["deleted_at", "updated_by", "updated_at"])
                placement = WorkMapBindingPlacement.objects.create(
                    work_map=work_map,
                    binding=binding,
                    placement_id=data["placement_id"],
                    created_by=request.user,
                )
        except IntegrityError:
            return Response({"error": "Placement unavailable"}, status=status.HTTP_409_CONFLICT)
        return Response(
            {
                "placement_id": placement.placement_id,
                "node_key": binding.node_key,
                "revision": binding.revision,
                "generation": work_map.generation,
            },
            status=status.HTTP_201_CREATED,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, work_map_id, placement_id):
        serializer = WorkMapBindingCancelSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            visible_id = (
                visible_work_maps(user=request.user, slug=slug, project_id=project_id)
                .filter(id=work_map_id)
                .values_list("id", flat=True)
                .first()
            )
            document = Document.objects.select_for_update().filter(id=visible_id).first()
            if document is None:
                return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
            work_map = WorkMap.objects.select_for_update().get(pk=document.id)
            if serializer.validated_data["generation"] != work_map.generation:
                return Response(
                    {"error": "Work map generation is stale", "generation": work_map.generation},
                    status=status.HTTP_409_CONFLICT,
                )
            if document.is_locked or document.archived_at is not None:
                return Response({"error": "Work map is not editable"}, status=status.HTTP_409_CONFLICT)
            placement = (
                WorkMapBindingPlacement.all_objects.select_for_update()
                .filter(
                    work_map=work_map,
                    created_by=request.user,
                    placement_id=placement_id,
                )
                .first()
            )
            if placement is None or placement.deleted_at is not None:
                return Response(status=status.HTTP_204_NO_CONTENT)
            binding = WorkMapBinding.all_objects.select_for_update().get(id=placement.binding_id)
            from .scene import LEGACY_SCENE_UPGRADE_ERROR, try_decode_work_map_scene

            scene = try_decode_work_map_scene(work_map.scene_binary)
            if scene is None:
                return Response({"error": LEGACY_SCENE_UPGRADE_ERROR}, status=status.HTTP_409_CONFLICT)
            carrier_keys = protected_binding_keys(scene)
            if binding.node_key in carrier_keys:
                if placement.acknowledged_at is None:
                    placement.acknowledged_at = timezone.now()
                    placement.save(update_fields=["acknowledged_at", "updated_at"])
                return Response(status=status.HTTP_204_NO_CONTENT)
            placement.delete()
            if not WorkMapBindingPlacement.objects.filter(binding=binding).exists():
                binding.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
