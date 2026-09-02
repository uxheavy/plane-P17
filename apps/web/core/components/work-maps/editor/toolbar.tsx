/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslation } from "@plane/i18n";
import type { EditorShortcut, HostToolbarItem, ToolShortcutOverrides } from "@excalidraw/excalidraw/types";
import type { TWorkMapSourceKind } from "@plane/types";
import { Boxes, ListTodo } from "lucide-react";

const SOURCE_KIND_KEYS: Record<TWorkMapSourceKind, string> = {
  "work-item": "common.work_items",
  cycle: "common.cycles",
  module: "common.modules",
  "project-view": "common.view",
  page: "common.pages",
  "intake-item": "common.intake",
};

export const WORK_MAP_TOOL_SHORTCUTS: ToolShortcutOverrides = {
  diamond: [{ key: "3" }],
  freedraw: ["D", "B", "X", "P", "7"].map((key): EditorShortcut => ({ key })),
  autoshape: [{ key: "X", shiftKey: true }],
  bucketfill: [],
};

type ToolbarProps = {
  editable: boolean;
  sourceKind: TWorkMapSourceKind | null;
  onSelectSourceKind: (sourceKind: TWorkMapSourceKind) => void;
  onCancelSourceTool: () => void;
};

export function useWorkMapToolbarItems({
  editable,
  sourceKind,
  onSelectSourceKind,
  onCancelSourceTool,
}: ToolbarProps): readonly HostToolbarItem[] {
  const { t } = useTranslation();

  return useMemo(
    () => [
      {
        id: "work-item",
        label: t("common.add_work_item"),
        icon: <ListTodo />,
        shortcuts: [{ key: "W" }],
        disabled: !editable,
        checked: sourceKind === "work-item",
        onSelect: () => onSelectSourceKind("work-item"),
        onCancel: onCancelSourceTool,
      },
      {
        id: "source-menu",
        type: "menu" as const,
        label: t("common.add"),
        icon: <Boxes />,
        disabled: !editable,
        items: (Object.keys(SOURCE_KIND_KEYS) as TWorkMapSourceKind[])
          .filter((kind) => kind !== "work-item")
          .map((kind) => ({
            id: kind,
            label: t(SOURCE_KIND_KEYS[kind]),
            checked: sourceKind === kind,
            onSelect: () => onSelectSourceKind(kind),
            onCancel: onCancelSourceTool,
          })),
      },
    ],
    [editable, onCancelSourceTool, onSelectSourceKind, sourceKind, t]
  );
}
