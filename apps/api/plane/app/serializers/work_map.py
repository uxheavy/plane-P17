# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import base64
import binascii
from django.conf import settings
from rest_framework import serializers

from plane.db.models import WorkMapBinding, WorkMapVersion


class WorkMapCreateSerializer(serializers.Serializer):
    name = serializers.CharField(required=False, allow_blank=True, default="Untitled work map")
    access = serializers.ChoiceField(choices=(0, 1), required=False, default=0)


class WorkMapUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(required=False, allow_blank=True)
    access = serializers.ChoiceField(choices=(0, 1), required=False)


class WorkMapSceneSerializer(serializers.Serializer):
    generation = serializers.IntegerField(min_value=0)
    scene_binary = serializers.CharField(allow_blank=True)

    def validate_scene_binary(self, value):
        try:
            scene_binary = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError):
            raise serializers.ValidationError("Scene binary must be valid base64.")
        if len(scene_binary) > settings.DATA_UPLOAD_MAX_MEMORY_SIZE:
            raise serializers.ValidationError("Scene binary exceeds the configured upload limit.")
        return scene_binary


class WorkMapBindingCreateSerializer(serializers.Serializer):
    generation = serializers.IntegerField(min_value=0)
    placement_id = serializers.UUIDField()
    source_kind = serializers.ChoiceField(choices=WorkMapBinding.SourceKind.values)
    source_id = serializers.UUIDField()


class WorkMapSourceDiscoverySerializer(serializers.Serializer):
    source_kind = serializers.ChoiceField(choices=WorkMapBinding.SourceKind.values)
    query = serializers.CharField(required=False, allow_blank=True, max_length=255, default="")


class WorkMapBindingHydrationSerializer(serializers.Serializer):
    node_keys = serializers.ListField(child=serializers.UUIDField(), allow_empty=True, max_length=100)


class WorkMapBindingOpenSerializer(serializers.Serializer):
    node_key = serializers.UUIDField()


class WorkMapBindingCancelSerializer(serializers.Serializer):
    generation = serializers.IntegerField(min_value=0)


class WorkMapPasteFileSerializer(serializers.Serializer):
    file_id = serializers.CharField(max_length=128)
    asset_id = serializers.UUIDField()


class WorkMapPasteRebindingSerializer(serializers.Serializer):
    generation = serializers.IntegerField(min_value=0)
    idempotency_key = serializers.UUIDField()
    node_keys = serializers.ListField(child=serializers.UUIDField(), allow_empty=True, max_length=100)
    files = WorkMapPasteFileSerializer(many=True, required=False, default=list)

    def validate(self, attrs):
        node_keys = attrs["node_keys"]
        files = attrs["files"]
        if not node_keys and not files:
            raise serializers.ValidationError("Paste rebinding requires Plane-owned nodes or files.")
        if len(node_keys) != len(set(node_keys)):
            raise serializers.ValidationError("Paste node keys must be unique.")
        file_ids = [item["file_id"] for item in files]
        asset_ids = [item["asset_id"] for item in files]
        if len(file_ids) != len(set(file_ids)) or len(asset_ids) != len(set(asset_ids)):
            raise serializers.ValidationError("Paste files must be unique.")
        return attrs


class WorkMapVersionSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="document_version_id")
    work_map = serializers.UUIDField(source="document_version.document_id")
    owned_by = serializers.UUIDField(source="document_version.owned_by_id")
    created_at = serializers.DateTimeField(source="document_version.created_at")

    class Meta:
        model = WorkMapVersion
        fields = ["id", "work_map", "generation", "owned_by", "created_at"]
        read_only_fields = fields


class WorkMapVersionRestoreSerializer(serializers.Serializer):
    generation = serializers.IntegerField(min_value=0)
