# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Load baseline manifests and preserve ensure-only record ownership."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from django.core.management.base import CommandError


MANIFEST_FILES = {
    "operator": "operator.json",
    "workspace": "workspace.json",
    "members": "members.json",
    "roster": "roster.json",
    "projects": "projects.json",
}


class BaselineError(CommandError):
    """A manifest is missing, malformed, or internally inconsistent."""


def _find_active_or_tombstoned(model: Any, **lookup: Any) -> tuple[Any | None, bool]:
    """Return an active match first, or its tombstone without reviving it."""

    active = model.objects.filter(**lookup).order_by("created_at", "id").first()
    if active is not None:
        return active, False
    tombstone = model.all_objects.filter(**lookup, deleted_at__isnull=False).order_by("-deleted_at", "id").first()
    return tombstone, tombstone is not None


def _read(manifest_dir: Path, name: str) -> dict[str, Any]:
    path = manifest_dir / name
    if not path.is_file():
        raise BaselineError(f"baseline manifest is missing: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise BaselineError(f"baseline manifest is unreadable: {path}: {error}")
    if not isinstance(payload, dict):
        raise BaselineError(f"baseline manifest must be a JSON object: {path}")
    return payload


def _load(manifest_dir: Path) -> dict[str, Any]:
    if not manifest_dir.is_dir():
        raise BaselineError(f"baseline directory is missing: {manifest_dir}")
    return {key: _read(manifest_dir, name) for key, name in MANIFEST_FILES.items()}
