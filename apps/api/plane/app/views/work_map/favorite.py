# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.db.models import UserFavorite

from ..base import BaseViewSet
from .base import visible_work_maps


class WorkMapFavoriteViewSet(BaseViewSet):
    model = UserFavorite

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id, work_map_id):
        document = visible_work_maps(user=request.user, slug=slug, project_id=project_id).filter(id=work_map_id).first()
        if document is None:
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
        UserFavorite.objects.get_or_create(
            workspace=document.workspace,
            entity_identifier=work_map_id,
            entity_type="work_map",
            user=request.user,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def destroy(self, request, slug, project_id, work_map_id):
        if not visible_work_maps(user=request.user, slug=slug, project_id=project_id).filter(id=work_map_id).exists():
            return Response({"error": "Work map not found"}, status=status.HTTP_404_NOT_FOUND)
        favorite = UserFavorite.objects.filter(
            user=request.user,
            workspace__slug=slug,
            entity_identifier=work_map_id,
            entity_type="work_map",
        ).first()
        if favorite is None:
            return Response({"error": "Favorite not found"}, status=status.HTTP_404_NOT_FOUND)
        favorite.delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
