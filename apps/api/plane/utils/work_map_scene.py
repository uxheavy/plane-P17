# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only

# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
import uuid


# Work map image capabilities must remain identical to Excalidraw's exported
# IMAGE_MIME_TYPES; Plane-backed nodes add behavior without reducing native nodes.
WORK_MAP_SCENE_ASSET_MIME_TYPES = (
    "image/avif",
    "image/bmp",
    "image/gif",
    "image/jpeg",
    "image/jfif",
    "image/png",
    "image/svg+xml",
    "image/webp",
    "image/x-icon",
)


class WorkMapSceneOpaque(ValueError):
    """The bytes do not use the lifecycle scene representation."""


def decode_work_map_scene(scene_binary):
    if not scene_binary:
        return {"elements": [], "files": {}}

    try:
        scene = json.loads(bytes(scene_binary).decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise WorkMapSceneOpaque("Scene is not valid Work map JSON")
    if (
        not isinstance(scene, dict)
        or not isinstance(scene.get("elements"), list)
        or not isinstance(scene.get("files"), dict)
    ):
        raise WorkMapSceneOpaque("Scene is not a Work map document")
    return scene


def try_decode_work_map_scene(scene_binary):
    """Decode structured scene data without changing the opaque scene contract."""
    try:
        return decode_work_map_scene(scene_binary)
    except WorkMapSceneOpaque:
        return None


def parse_work_map_node_key(value):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        raise ValueError("Work map node key is invalid")


def persisted_scene_node_keys(scene_binary):
    """Read node keys from both structured and legacy scene bytes."""
    try:
        scene = json.loads(bytes(scene_binary).decode("utf-8")) if scene_binary else {"elements": []}
        return {
            parse_work_map_node_key(element["customData"]["nodeKey"])
            for element in scene["elements"]
            if isinstance(element, dict)
            and isinstance(element.get("customData"), dict)
            and element["customData"].get("nodeKey") is not None
        }
    except (KeyError, TypeError, ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def work_map_scene_assets(scene):
    assets = {}
    for file_id, metadata in scene["files"].items():
        if not isinstance(file_id, str) or not file_id or not isinstance(metadata, dict):
            raise ValueError("Scene file metadata is invalid")
        if set(metadata) != {"assetId", "mimeType", "created"}:
            raise ValueError("Scene file metadata contains unsupported fields")
        try:
            asset_id = uuid.UUID(str(metadata["assetId"]))
        except (TypeError, ValueError):
            raise ValueError("Scene file asset identifier is invalid")
        if metadata["mimeType"] not in WORK_MAP_SCENE_ASSET_MIME_TYPES:
            raise ValueError("Scene file MIME type is unsupported")
        if isinstance(metadata["created"], bool) or not isinstance(metadata["created"], int) or metadata["created"] < 0:
            raise ValueError("Scene file creation time is invalid")
        assets[file_id] = asset_id

    for element in scene["elements"]:
        if not isinstance(element, dict):
            raise ValueError("Scene element is invalid")
        if (
            element.get("type") == "image"
            and not element.get("isDeleted", False)
            and element.get("fileId") not in scene["files"]
        ):
            raise ValueError("Image element file is unavailable")
    return assets
