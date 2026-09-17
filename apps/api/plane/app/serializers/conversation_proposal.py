# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

from rest_framework import serializers


class ConversationProposalRequestSerializer(serializers.Serializer):
    request_id = serializers.UUIDField()
    agent_user_id = serializers.UUIDField()
    thread_id = serializers.UUIDField(required=False, allow_null=True, default=None)

    def validate(self, attrs):
        if set(self.initial_data) - {"request_id", "agent_user_id", "thread_id"}:
            raise serializers.ValidationError("Only proposal request fields are allowed")
        return attrs
