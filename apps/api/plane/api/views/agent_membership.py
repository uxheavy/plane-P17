from rest_framework import status
from rest_framework.response import Response
from drf_spectacular.utils import OpenApiParameter, extend_schema

from plane.api.services import AgentMembershipConflict, AgentMembershipError, WorkspaceAgentMemberships
from plane.api.serializers.agent_membership import AgentMembershipRequestSerializer, AgentMembershipResponseSerializer
from plane.api.views.base import BaseAPIView
from plane.db.models import Workspace


class WorkspaceAgentMembershipEndpoint(BaseAPIView):
    @extend_schema(
        request=AgentMembershipRequestSerializer,
        responses={200: AgentMembershipResponseSerializer},
        parameters=[
            OpenApiParameter(
                name="Idempotency-Key",
                location=OpenApiParameter.HEADER,
                required=True,
                type=str,
            )
        ],
    )
    def put(self, request, slug, agent_key):
        workspace = Workspace.objects.filter(slug=slug).first()
        if workspace is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            serializer = AgentMembershipRequestSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            result = WorkspaceAgentMemberships.apply(
                workspace_id=workspace.id,
                agent_key=agent_key,
                desired=serializer.validated_data,
                idempotency_key=request.headers.get("Idempotency-Key", ""),
                actor=request.user,
            )
        except PermissionError as error:
            return Response({"error": str(error)}, status=status.HTTP_403_FORBIDDEN)
        except AgentMembershipConflict as error:
            return Response({"error": str(error)}, status=status.HTTP_409_CONFLICT)
        except AgentMembershipError as error:
            return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result, status=status.HTTP_200_OK)
