# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

from django.urls import path

from plane.app.views import (
    ChannelListCreateEndpoint,
    ChannelMessageListCreateEndpoint,
    ChannelThreadMessageListEndpoint,
)
from plane.app.views import ChannelAttachmentEndpoint


urlpatterns = [
    path(
        "workspaces/<str:slug>/channels/",
        ChannelListCreateEndpoint.as_view(),
        name="workspace-channels",
    ),
    path(
        "channels/<uuid:channel_id>/messages/",
        ChannelMessageListCreateEndpoint.as_view(),
        name="channel-messages",
    ),
    path(
        "channels/<uuid:channel_id>/threads/<uuid:root_id>/messages/",
        ChannelThreadMessageListEndpoint.as_view(),
        name="channel-thread-messages",
    ),
    path(
        "channels/<uuid:channel_id>/attachments/",
        ChannelAttachmentEndpoint.as_view(http_method_names=["get", "post"]),
        name="channel-attachments",
    ),
    path(
        "channels/<uuid:channel_id>/attachments/<uuid:asset_id>/",
        ChannelAttachmentEndpoint.as_view(http_method_names=["get", "patch", "delete"]),
        name="channel-attachment-detail",
    ),
]
