# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import serializers


class AgentMembershipRequestSerializer(serializers.Serializer):
    display_name = serializers.CharField(max_length=255)
    state = serializers.ChoiceField(choices=("active", "disabled"))
    project_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=True)
    credential_action = serializers.ChoiceField(choices=("ensure", "rotate"), default="ensure")


class AgentMembershipResponseSerializer(serializers.Serializer):
    membership_id = serializers.UUIDField()
    user_id = serializers.UUIDField()
    workspace_id = serializers.UUIDField()
    state = serializers.ChoiceField(choices=("active", "disabled"))
    project_ids = serializers.ListField(child=serializers.UUIDField())
    credential = serializers.CharField(allow_null=True, help_text="Returned once on create, rotate, or reactivation.")
    replayed = serializers.BooleanField()
