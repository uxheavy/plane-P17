# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path

from plane.app.views import ConversationProposalEndpoint


urlpatterns = [
    path(
        "channels/<uuid:channel_id>/conversation-proposals/",
        ConversationProposalEndpoint.as_view(http_method_names=["get", "post"]),
        name="channel-conversation-proposals",
    ),
]
