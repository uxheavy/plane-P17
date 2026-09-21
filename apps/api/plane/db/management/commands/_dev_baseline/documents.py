# Copyright (c) 2026-present Ngo Quoc Huy
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Reconcile project-scoped pages, Work Maps, and source bindings."""

from __future__ import annotations

import json
import uuid
from typing import Any

from plane.db.management.commands._dev_baseline.manifest import (
    BaselineError,
    _find_active_or_tombstoned,
)
from plane.db.models import (
    Cycle,
    Document,
    DocumentProject,
    Issue,
    Module,
    Page,
    Project,
    User,
    WorkMap,
    WorkMapBinding,
    Workspace,
)


def _ensure_pages(
    workspace: Workspace,
    project: Project,
    spec: dict[str, Any],
    actor: User,
) -> int:
    """Ensure project-scoped brief pages without rewriting existing content.

    ``Page`` inherits ``Document`` through a one-to-one primary key, while the
    ``DocumentProject`` link owns project identity. Equal names in different
    projects therefore create distinct pages; active or tombstoned links in the
    same project remain authoritative user state.
    """

    created = 0
    for entry in spec.get("pages") or []:
        name = entry.get("name")
        if not name:
            raise BaselineError(f"project {project.identifier!r} has a page without a name")
        document_links = DocumentProject.all_objects.filter(
            workspace=workspace,
            project=project,
            document__workspace=workspace,
            document__kind=Document.Kind.PAGE,
            document__name=name,
        )
        if document_links.exists():
            continue
        page = Page.objects.create(
            workspace=workspace,
            kind=Document.Kind.PAGE,
            name=name,
            owned_by=actor,
            created_by=actor,
            description_html=entry.get("body", "<p></p>"),
        )
        DocumentProject.objects.create(
            document_id=page.id,
            project=project,
            workspace=workspace,
            created_by=actor,
        )
        created += 1
    return created


def _scene_document(
    title: str,
    lanes: list[tuple[str, list[str]]],
    bindings: dict[str, str] | None = None,
) -> bytes:
    """Build an Excalidraw-compatible work map scene.

    A work map with empty scene bytes opens as a blank canvas, which a reviewer
    cannot distinguish from a broken canvas. The scene is the same shape
    Excalidraw persists: a list of elements and a files map. Frames carry the
    swimlanes and bound text carries the labels, so a project's work is legible
    the moment the map is opened.

    ``bindings`` maps a card label to a node key. A bound card becomes a carrier:
    a rectangle whose ``customData`` is exactly ``{"nodeKey": ...}``. The binding
    contract refuses any other custom data or shape, and refuses a carrier whose
    node key has no live binding, so the two are written together or not at all.
    """

    bindings = bindings or {}
    elements: list[dict[str, Any]] = []
    lane_width = 340
    lane_gap = 40
    card_height = 64
    card_gap = 18
    top = 120

    elements.append(
        {
            "id": "title",
            "type": "text",
            "x": 0,
            "y": 0,
            "width": 620,
            "height": 40,
            "angle": 0,
            "strokeColor": "#1e1e1e",
            "backgroundColor": "transparent",
            "fillStyle": "solid",
            "strokeWidth": 2,
            "strokeStyle": "solid",
            "roughness": 0,
            "opacity": 100,
            "groupIds": [],
            "frameId": None,
            "roundness": None,
            "seed": 1,
            "version": 1,
            "versionNonce": 1,
            "isDeleted": False,
            "boundElements": None,
            "updated": 1,
            "link": None,
            "locked": False,
            "fontSize": 28,
            "fontFamily": 1,
            "text": title,
            "textAlign": "left",
            "verticalAlign": "top",
            "containerId": None,
            "originalText": title,
            "lineHeight": 1.25,
            "baseline": 28,
        }
    )

    for lane_index, (lane_name, cards) in enumerate(lanes):
        lane_x = lane_index * (lane_width + lane_gap)
        frame_id = f"lane-{lane_index}"
        frame_height = top + len(cards) * (card_height + card_gap) + 20
        elements.append(
            {
                "id": frame_id,
                "type": "frame",
                "x": lane_x,
                "y": top - 40,
                "width": lane_width,
                "height": frame_height,
                "angle": 0,
                "strokeColor": "#c7c7c7",
                "backgroundColor": "transparent",
                "fillStyle": "solid",
                "strokeWidth": 1,
                "strokeStyle": "solid",
                "roughness": 0,
                "opacity": 100,
                "groupIds": [],
                "frameId": None,
                "roundness": None,
                "seed": 100 + lane_index,
                "version": 1,
                "versionNonce": 100 + lane_index,
                "isDeleted": False,
                "boundElements": None,
                "updated": 1,
                "link": None,
                "locked": False,
                "name": lane_name,
            }
        )
        # The frame label is its own text element, which is how Excalidraw
        # renders a frame name on the canvas rather than only in the sidebar.
        elements.append(
            {
                "id": f"{frame_id}-label",
                "type": "text",
                "x": lane_x + 8,
                "y": top - 32,
                "width": lane_width - 16,
                "height": 24,
                "angle": 0,
                "strokeColor": "#495057",
                "backgroundColor": "transparent",
                "fillStyle": "solid",
                "strokeWidth": 1,
                "strokeStyle": "solid",
                "roughness": 0,
                "opacity": 100,
                "groupIds": [],
                "frameId": frame_id,
                "roundness": None,
                "seed": 200 + lane_index,
                "version": 1,
                "versionNonce": 200 + lane_index,
                "isDeleted": False,
                "boundElements": None,
                "updated": 1,
                "link": None,
                "locked": False,
                "fontSize": 18,
                "fontFamily": 1,
                "text": lane_name,
                "textAlign": "left",
                "verticalAlign": "top",
                "containerId": None,
                "originalText": lane_name,
                "lineHeight": 1.25,
                "baseline": 18,
            }
        )
        for card_index, card in enumerate(cards):
            card_y = top + card_index * (card_height + card_gap)
            rect_id = f"{frame_id}-card-{card_index}"
            text_id = f"{rect_id}-text"
            node_key = bindings.get(card)
            rectangle: dict[str, Any] = {
                "id": rect_id,
                "type": "rectangle",
                "x": lane_x + 12,
                "y": card_y,
                "width": lane_width - 24,
                "height": card_height,
                "angle": 0,
                "strokeColor": "#1971c2",
                "backgroundColor": "#e7f5ff",
                "fillStyle": "solid",
                "strokeWidth": 1,
                "strokeStyle": "solid",
                "roughness": 0,
                "opacity": 100,
                "groupIds": [],
                "frameId": frame_id,
                "roundness": {"type": 3},
                "seed": 1000 + lane_index * 100 + card_index,
                "version": 1,
                "versionNonce": 1000 + lane_index * 100 + card_index,
                "isDeleted": False,
                "boundElements": [{"id": text_id, "type": "text"}],
                "updated": 1,
                "link": None,
                "locked": False,
            }
            if node_key is not None:
                # A carrier's customData holds the node key and nothing else, and
                # it must not carry a link. This is the shape the binding
                # contract accepts for a Company Runner carrier.
                rectangle["customData"] = {"nodeKey": node_key}
            elements.append(rectangle)
            elements.append(
                {
                    "id": text_id,
                    "type": "text",
                    "x": lane_x + 24,
                    "y": card_y + 12,
                    "width": lane_width - 48,
                    "height": 40,
                    "angle": 0,
                    "strokeColor": "#1e1e1e",
                    "backgroundColor": "transparent",
                    "fillStyle": "solid",
                    "strokeWidth": 1,
                    "strokeStyle": "solid",
                    "roughness": 0,
                    "opacity": 100,
                    "groupIds": [],
                    "frameId": frame_id,
                    "roundness": None,
                    "seed": 2000 + lane_index * 100 + card_index,
                    "version": 1,
                    "versionNonce": 2000 + lane_index * 100 + card_index,
                    "isDeleted": False,
                    "boundElements": None,
                    "updated": 1,
                    "link": None,
                    "locked": False,
                    "fontSize": 14,
                    "fontFamily": 1,
                    "text": card,
                    "textAlign": "left",
                    "verticalAlign": "top",
                    "containerId": rect_id,
                    "originalText": card,
                    "lineHeight": 1.25,
                    "baseline": 14,
                    "autoResize": True,
                }
            )

    return json.dumps(
        {
            "type": "excalidraw",
            "version": 2,
            "source": "company-runner-baseline",
            "elements": elements,
            "appState": {"gridSize": None, "viewBackgroundColor": "#ffffff"},
            "files": {},
        }
    ).encode("utf-8")


def _ensure_work_maps(
    workspace: Workspace,
    project: Project,
    spec: dict[str, Any],
    actor: User,
) -> tuple[int, int]:
    """Create missing work maps with their initial scene and source bindings.

    Existing maps are user-owned and never rewritten by baseline replay. A new
    work map is a ``Document`` of kind ``work-map`` plus a ``WorkMap`` row and
    a project link, exactly as the create endpoint builds it. ``WorkMap`` shares
    the document's primary key, so the document is created first and the row
    references it rather than the reverse.

    A map whose cards are unbound is a picture of work rather than a view onto
    it. Each bound card gets a carrier element in the scene and a binding row to
    the Plane object it represents, so opening the map reaches the real work
    item, module, or cycle.

    Returns how many work maps and how many bindings were created.
    """

    created = 0
    bindings_created = 0
    for entry in spec.get("work_maps") or []:
        name = entry.get("name")
        if not name:
            raise BaselineError(f"project {project.identifier!r} has a work map without a name")
        document_links = DocumentProject.all_objects.filter(
            workspace=workspace,
            project=project,
            document__workspace=workspace,
            document__kind=Document.Kind.WORK_MAP,
            document__name=name,
        )
        if document_links.exists():
            # Baseline ownership ends after initial creation. Active maps keep
            # user edits; soft-deleted maps and links remain deleted.
            continue

        targets = _resolve_bindings(workspace, project, entry)
        document = Document.objects.create(
            kind=Document.Kind.WORK_MAP,
            workspace=workspace,
            owned_by=actor,
            created_by=actor,
            name=name,
            access=entry.get("access", Document.PUBLIC_ACCESS),
        )
        created += 1
        card_keys = {
            card: str(uuid.uuid5(document.id, card))
            for lane in entry.get("lanes") or []
            for value in lane.get("cards") or []
            if (card := str(value)) in targets
        }
        lanes = [
            (str(lane.get("name") or ""), [str(card) for card in lane.get("cards") or []])
            for lane in entry.get("lanes") or []
        ]
        work_map = WorkMap.objects.create(
            document=document,
            scene_binary=_scene_document(name, lanes, card_keys),
            generation=1,
        )
        for card, node_key in card_keys.items():
            source_kind, source_id = targets[card]
            WorkMapBinding.objects.create(
                work_map=work_map,
                node_key=node_key,
                source_kind=source_kind,
                source_id=source_id,
                created_by=actor,
            )
            bindings_created += 1
        DocumentProject.objects.get_or_create(
            document_id=document.id,
            project=project,
            workspace=workspace,
            defaults={"created_by": actor},
        )
    return created, bindings_created


def _resolve_bindings(
    workspace: Workspace,
    project: Project,
    work_map: dict[str, Any],
) -> dict[str, tuple[str, str]]:
    """Resolve each declared binding to its project-scoped Plane object.

    An unresolvable target fails here, before the scene is written, rather than
    producing a carrier whose binding is missing.
    """

    target_ids: dict[str, tuple[str, str]] = {}
    scene_cards = {str(card) for lane in work_map.get("lanes") or [] for card in lane.get("cards") or []}
    resolvers: dict[str, Any] = {
        WorkMapBinding.SourceKind.WORK_ITEM: Issue,
        WorkMapBinding.SourceKind.MODULE: Module,
        WorkMapBinding.SourceKind.CYCLE: Cycle,
    }
    for binding in work_map.get("bindings") or []:
        card = binding.get("card")
        source_kind = binding.get("source_kind")
        source_name = binding.get("source_name")
        if not card or not source_kind or not source_name:
            raise BaselineError(
                f"work map {work_map.get('name')!r} has a binding missing a card, source_kind, or source_name"
            )
        card = str(card)
        if card not in scene_cards:
            raise BaselineError(f"work map {work_map.get('name')!r} binds card {card!r}, which no lane declares")
        model = resolvers.get(source_kind)
        if model is None:
            raise BaselineError(
                f"work map {work_map.get('name')!r} binds card {card!r} to unsupported source_kind {source_kind!r}"
            )
        target, tombstoned = _find_active_or_tombstoned(
            model,
            workspace=workspace,
            project=project,
            name=source_name,
        )
        if tombstoned:
            continue
        if target is None:
            raise BaselineError(
                f"work map {work_map.get('name')!r} binds card {card!r} to "
                f"{source_kind} {source_name!r}, which does not exist in this project"
            )
        target_ids[str(card)] = (source_kind, str(target.id))
    return target_ids
