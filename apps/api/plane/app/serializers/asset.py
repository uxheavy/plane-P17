# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.conf import settings
from rest_framework import serializers

from plane.db.models import FileAsset
from plane.utils.path_validator import sanitize_filename
from plane.utils.work_map_scene import WORK_MAP_SCENE_ASSET_MIME_TYPES

from .base import BaseSerializer


class FileAssetSerializer(BaseSerializer):
    def validate(self, attrs):
        if attrs.get("entity_type") == FileAsset.EntityTypeContext.PAGE_DESCRIPTION and attrs.get("page") is not None:
            attrs["document"] = attrs["page"]
        return attrs

    class Meta:
        model = FileAsset
        fields = "__all__"
        read_only_fields = ["created_by", "updated_by", "created_at", "updated_at"]


class WorkMapSceneAssetCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    mime_type = serializers.ChoiceField(choices=WORK_MAP_SCENE_ASSET_MIME_TYPES)
    size = serializers.IntegerField(min_value=1, max_value=settings.FILE_SIZE_LIMIT)

    def validate_name(self, value):
        return sanitize_filename(value) or "unnamed"


class WorkMapSceneAssetSerializer(serializers.ModelSerializer):
    asset_id = serializers.UUIDField(source="id")
    name = serializers.CharField(source="attributes.name")
    mime_type = serializers.CharField(source="attributes.type")
    asset_url = serializers.SerializerMethodField()

    def get_asset_url(self, asset):
        project_id = self.context["project_id"]
        return (
            f"/api/assets/v2/workspaces/{asset.workspace.slug}/projects/{project_id}/"
            f"work-maps/{asset.document_id}/scene-assets/{asset.id}/"
        )

    class Meta:
        model = FileAsset
        fields = ["asset_id", "name", "mime_type", "size", "asset_url", "is_uploaded"]
        read_only_fields = fields
