# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from enum import StrEnum

from django.db import transaction

from plane.settings.redis import redis_instance


WORK_MAP_CONTROL_CHANNEL = "work-map:control"


class WorkMapRelayCloseReason(StrEnum):
    GENERATION_CHANGED = "generation_changed"
    AUTHORITY_CHANGED = "authority_changed"


def force_close_work_map_relay_on_commit(
    workspace_slug: str,
    work_map_id: str,
    reason: WorkMapRelayCloseReason,
) -> None:
    """Reset active relay attachments only after their owning transaction commits."""

    message = json.dumps(
        {
            "type": "FORCE_CLOSE",
            "workspaceSlug": workspace_slug,
            "workMapId": work_map_id,
            "reason": reason.value,
        },
        separators=(",", ":"),
    )

    def publish() -> None:
        redis_instance().publish(WORK_MAP_CONTROL_CHANNEL, message)

    transaction.on_commit(publish, robust=True)
