# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import base64
import binascii
import uuid

from django.conf import settings
from rest_framework import serializers

from plane.db.models import WorkMapBinding


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
    node_key = serializers.UUIDField(required=False, default=uuid.uuid4)
    source_kind = serializers.ChoiceField(choices=WorkMapBinding.SourceKind.values)
    source_id = serializers.UUIDField()


class WorkMapSourceDiscoverySerializer(serializers.Serializer):
    source_kind = serializers.ChoiceField(choices=WorkMapBinding.SourceKind.values)
    query = serializers.CharField(required=False, allow_blank=True, max_length=255, default="")
    project_id = serializers.UUIDField(required=False)


class WorkMapBindingHydrationSerializer(serializers.Serializer):
    node_keys = serializers.ListField(child=serializers.UUIDField(), allow_empty=True, max_length=100)


class WorkMapBindingOpenSerializer(serializers.Serializer):
    node_key = serializers.UUIDField()
