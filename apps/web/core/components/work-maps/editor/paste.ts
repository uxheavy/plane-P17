/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ClipboardData } from "@excalidraw/excalidraw/clipboard";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { getNodeKey } from "./scene";

const isProtectedCarrier = (element: ExcalidrawElement) =>
  element.type === "rectangle" && typeof getNodeKey(element) === "string";

const collectNodeKeys = (elements: readonly ExcalidrawElement[]) => {
  const keys: string[] = [];
  for (const element of elements) {
    const nodeKey = getNodeKey(element);
    if (nodeKey) keys.push(nodeKey);
  }
  return new Set(keys);
};

export const allowPaste = (
  data: ClipboardData,
  currentElements: readonly ExcalidrawElement[]
): ClipboardData | false => {
  if (!data.elements?.some(isProtectedCarrier)) return data;

  const currentNodeKeys = new Set(currentElements.map(getNodeKey).filter((nodeKey): nodeKey is string => !!nodeKey));
  for (const element of data.elements) {
    if (!isProtectedCarrier(element)) continue;
    const nodeKey = getNodeKey(element);
    if (!nodeKey || !currentNodeKeys.has(nodeKey)) return false;
  }
  return data;
};

export const rebindProtectedPaste = async (
  data: ClipboardData,
  currentElements: readonly ExcalidrawElement[],
  rebind: (nodeKeys: string[]) => Promise<Record<string, string>>
): Promise<ClipboardData | false> => {
  if (!data.elements?.some(isProtectedCarrier)) return data;

  const currentNodeKeys = collectNodeKeys(currentElements);
  const pastedNodeKeys = [...collectNodeKeys(data.elements.filter(isProtectedCarrier))];
  if (pastedNodeKeys.length === 0) return false;
  if (pastedNodeKeys.every((nodeKey) => currentNodeKeys.has(nodeKey))) return data;

  const nodeKeyMap = await rebind(pastedNodeKeys);
  const elements = data.elements.map((element) => {
    if (!isProtectedCarrier(element)) return element;
    const nodeKey = getNodeKey(element);
    const reboundNodeKey = nodeKey ? nodeKeyMap[nodeKey] : undefined;
    if (!reboundNodeKey) throw new Error("Work Map paste rebinding was incomplete");
    return {
      ...element,
      customData: { nodeKey: reboundNodeKey },
    };
  });
  return { ...data, elements };
};
