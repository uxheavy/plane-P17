# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

from rest_framework import serializers

from plane.db.models import Channel, Message, User

from .asset import ChannelAttachmentSerializer


class ChannelSerializer(serializers.ModelSerializer):
    class Meta:
        model = Channel
        fields = ["id", "name", "created_at"]
        read_only_fields = fields


class ChannelCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, allow_blank=False)


class ChannelAttachmentCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=800, allow_blank=False)
    mime_type = serializers.CharField(max_length=255, allow_blank=False)
    size = serializers.IntegerField(min_value=1)


class MessageAuthorSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "display_name", "avatar_url"]
        read_only_fields = fields


class MessageCreateSerializer(serializers.Serializer):
    content = serializers.CharField(allow_blank=True, required=False, default="")
    parent_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    client_id = serializers.UUIDField()
    attachment_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        allow_empty=True,
        default=list,
    )

    def validate(self, attrs):
        if not attrs["content"].strip() and not attrs["attachment_ids"]:
            raise serializers.ValidationError("Message content or at least one attachment is required")
        return attrs


class MessageSerializer(serializers.ModelSerializer):
    channel_id = serializers.UUIDField(read_only=True)
    parent_id = serializers.UUIDField(read_only=True)
    root_id = serializers.SerializerMethodField()
    client_id = serializers.UUIDField(read_only=True)
    author = serializers.SerializerMethodField()
    attachments = ChannelAttachmentSerializer(many=True, read_only=True)
    reply_count = serializers.SerializerMethodField()
    created_work_item = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            "id",
            "channel_id",
            "parent_id",
            "root_id",
            "content",
            "client_id",
            "created_at",
            "author",
            "reply_count",
            "attachments",
            "created_work_item",
        ]
        read_only_fields = fields

    def get_root_id(self, obj):
        root_id = getattr(obj, "_root_id", None)
        if root_id is None and obj.parent_id is not None:
            raise serializers.ValidationError("Message root was not resolved")
        return obj.id if root_id is None else root_id

    def get_author(self, obj):
        return MessageAuthorSerializer(obj.created_by).data

    def get_reply_count(self, obj):
        return getattr(obj, "_reply_count", 0)

    def get_created_work_item(self, obj):
        if not getattr(obj, "_created_work_item_visible", False):
            return None
        intent = getattr(obj, "created_work_item_intent", None)
        issue = getattr(intent, "issue", None) if intent else None
        if issue is None:
            return None
        return {
            "id": str(issue.id),
            "project_id": str(issue.project_id),
            "name": issue.name,
        }
