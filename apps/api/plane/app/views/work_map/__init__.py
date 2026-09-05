# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only


from .base import WorkMapViewSet
from .binding import WorkMapBindingEndpoint
from .duplicate import WorkMapDuplicateEndpoint
from .favorite import WorkMapFavoriteViewSet
from .paste import WorkMapPasteRebindingEndpoint
from .realtime import WorkMapRealtimeEndpoint
from .scene import WorkMapSceneEndpoint
from .version import WorkMapVersionEndpoint, WorkMapVersionRestoreEndpoint

__all__ = [
    "WorkMapBindingEndpoint",
    "WorkMapDuplicateEndpoint",
    "WorkMapFavoriteViewSet",
    "WorkMapPasteRebindingEndpoint",
    "WorkMapRealtimeEndpoint",
    "WorkMapSceneEndpoint",
    "WorkMapVersionEndpoint",
    "WorkMapVersionRestoreEndpoint",
    "WorkMapViewSet",
]
