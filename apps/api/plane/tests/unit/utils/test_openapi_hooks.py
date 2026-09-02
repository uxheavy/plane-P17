# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from plane.utils.openapi.hooks import preprocess_filter_api_v1_paths


def test_public_api_put_route_is_preserved_for_schema_generation():
    lifecycle = (
        "/api/v1/workspaces/{slug}/agent-memberships/{agent_key}/",
        "",
        "PUT",
        object(),
    )
    internal = ("/internal/server/status/", "", "GET", object())

    assert preprocess_filter_api_v1_paths([lifecycle, internal]) == [lifecycle]
