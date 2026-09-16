from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ProjectEntityPermission
from plane.api.serializers import WorkItemClaimRequestSerializer, WorkItemClaimResponseSerializer
from plane.api.services import (
    WorkItemClaimConflict,
    WorkItemClaimError,
    WorkItemClaimForbidden,
    WorkItemClaimNotFound,
    WorkItemClaimUnavailable,
    WorkItemClaims,
)
from plane.api.views.base import BaseAPIView


class WorkItemClaimEndpoint(BaseAPIView):
    permission_classes = [ProjectEntityPermission]

    @extend_schema(
        request=WorkItemClaimRequestSerializer,
        responses={201: WorkItemClaimResponseSerializer, 200: WorkItemClaimResponseSerializer},
    )
    def post(self, request, slug, project_id, issue_id):
        serializer = WorkItemClaimRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = WorkItemClaims.claim(
                workspace_slug=slug,
                project_id=project_id,
                issue_id=issue_id,
                request_id=serializer.validated_data["request_id"],
                actor=request.user,
            )
        except WorkItemClaimForbidden as error:
            return Response({"error": str(error)}, status=status.HTTP_403_FORBIDDEN)
        except WorkItemClaimNotFound as error:
            return Response({"error": str(error)}, status=status.HTTP_404_NOT_FOUND)
        except (WorkItemClaimConflict, WorkItemClaimUnavailable) as error:
            return Response({"error": str(error)}, status=status.HTTP_409_CONFLICT)
        except WorkItemClaimError as error:
            return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)

        response_serializer = WorkItemClaimResponseSerializer(result)
        return Response(
            response_serializer.data,
            status=status.HTTP_200_OK if result["replayed"] else status.HTTP_201_CREATED,
        )
