/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useState } from "react";
import { ToolbarButton, ToolbarMenu } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { TWorkMapSourceKind } from "@plane/types";
import { Boxes, ListTodo } from "lucide-react";
import { isTypingInInput } from "@/components/power-k/core/shortcut-handler";
import { WORK_MAP_SOURCE_KINDS } from "../source-picker";

const SOURCE_KIND_LABELS: Record<TWorkMapSourceKind, string> = {
  "work-item": "Work item",
  cycle: "Cycle",
  module: "Module",
  "project-view": "Project view",
  page: "Page",
  "intake-item": "Intake item",
};

type ToolbarProps = {
  editable: boolean;
  sourceKind: TWorkMapSourceKind | null;
  onSelectSourceKind: (sourceKind: TWorkMapSourceKind) => void;
};

export function WorkMapToolbar({ editable, sourceKind, onSelectSourceKind }: ToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <ToolbarButton
        type="toggle"
        checked={sourceKind === "work-item"}
        icon={<ListTodo />}
        keyBindingLabel="W"
        aria-label="Add work item"
        aria-keyshortcuts="W"
        title="Add work item — W"
        disabled={!editable}
        data-testid="work-map-add-work-item"
        onSelect={() => onSelectSourceKind("work-item")}
      />
      <ToolbarMenu open={menuOpen}>
        <ToolbarMenu.Trigger
          aria-label="Add another Plane node"
          title="Add another Plane node"
          disabled={!editable}
          onToggle={() => setMenuOpen((open) => !open)}
        >
          <Boxes />
        </ToolbarMenu.Trigger>
        <ToolbarMenu.Content onClickOutside={() => setMenuOpen(false)} onSelect={() => setMenuOpen(false)}>
          {WORK_MAP_SOURCE_KINDS.slice(1).map((kind) => (
            <ToolbarMenu.Item key={kind} selected={sourceKind === kind} onSelect={() => onSelectSourceKind(kind)}>
              {SOURCE_KIND_LABELS[kind]}
            </ToolbarMenu.Item>
          ))}
        </ToolbarMenu.Content>
      </ToolbarMenu>
    </>
  );
}

export function useWorkMapToolShortcuts(
  api: ExcalidrawImperativeAPI | null,
  editable: boolean,
  sourceToolActive: boolean,
  onSelectSourceKind: (sourceKind: TWorkMapSourceKind) => void,
  onCancelSourceTool: () => void
) {
  useEffect(() => {
    if (!api || !editable) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        isTypingInInput(event.target) ||
        event.target instanceof HTMLSelectElement
      )
        return;

      const key = event.key.toLowerCase();
      if (key === "escape" && sourceToolActive) {
        onCancelSourceTool();
      } else if (key === "w") {
        event.preventDefault();
        event.stopImmediatePropagation();
        api.setActiveTool({ type: "selection" });
        onSelectSourceKind("work-item");
      } else if (key === "d" || key === "b" || key === "x") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancelSourceTool();
        api.setActiveTool({ type: "freedraw" });
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [api, editable, onCancelSourceTool, onSelectSourceKind, sourceToolActive]);
}
