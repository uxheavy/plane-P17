from rest_framework import serializers


class WorkItemClaimRequestSerializer(serializers.Serializer):
    request_id = serializers.UUIDField()

    def validate(self, attrs):
        unknown = set(self.initial_data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({"detail": "Only request_id is accepted"})
        return attrs


class WorkItemClaimResponseSerializer(serializers.Serializer):
    claim_id = serializers.UUIDField()
    request_id = serializers.UUIDField()
    issue_id = serializers.UUIDField()
    actor_id = serializers.UUIDField()
    project_id = serializers.UUIDField()
    workspace_id = serializers.UUIDField()
    state_id = serializers.UUIDField()
    state_name = serializers.CharField()
    replayed = serializers.BooleanField()
