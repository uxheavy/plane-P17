/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslation } from "@plane/i18n";
import type { EditorShortcut, HostToolbarItem, ToolShortcutOverrides } from "@excalidraw/excalidraw/types";
import type { TWorkMapSourceKind } from "@plane/types";
import { Boxes, Eye, ListTodo } from "lucide-react";

const SOURCE_KIND_KEYS: Record<TWorkMapSourceKind, string> = {
  "work-item": "work_items",
  cycle: "cycles",
  module: "modules",
  "project-view": "views",
  page: "pages",
  "intake-item": "intake",
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
  selectedNodeKey: string | null;
  onSelectSourceKind: (sourceKind: TWorkMapSourceKind) => void;
  onOpenSelectedSource: () => void;
  onCancelSourceTool: () => void;
};

export function useWorkMapToolbarItems({
  editable,
  sourceKind,
  selectedNodeKey,
  onSelectSourceKind,
  onOpenSelectedSource,
  onCancelSourceTool,
}: ToolbarProps): readonly HostToolbarItem[] {
  const { t } = useTranslation();

  return useMemo(
    () => [
      ...(selectedNodeKey
        ? [
            {
              id: "open-selected-source",
              label: t("preview"),
              icon: <Eye />,
              shortcuts: [{ key: "Enter" }],
              onSelect: onOpenSelectedSource,
            },
          ]
        : []),
      {
        id: "work-item",
        label: t("work_items"),
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
        label: t("add"),
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
    [editable, onCancelSourceTool, onOpenSelectedSource, onSelectSourceKind, selectedNodeKey, sourceKind, t]
  );
}
