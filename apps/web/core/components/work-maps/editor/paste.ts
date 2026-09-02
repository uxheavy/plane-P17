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
import { createNodeCarrierLink, getNodeKey, isNodeCarrierLink } from "./scene";

const isProtectedCarrier = (element: ExcalidrawElement) =>
  element.type === "embeddable" &&
  (typeof element.customData?.nodeKey === "string" || (!!element.link && isNodeCarrierLink(element.link)));

const collectNodeKeys = (elements: readonly ExcalidrawElement[]) => {
  const keys: string[] = [];
  for (const element of elements) {
    const nodeKey = getNodeKey(element);
    if (nodeKey) keys.push(nodeKey);
  }
  return new Set(keys);
};

export const rebindProtectedPaste = async (
  data: ClipboardData,
  currentElements: readonly ExcalidrawElement[],
  rebind: (nodeKeys: string[]) => Promise<Record<string, string>>
): Promise<ClipboardData | false> => {
  if (!data.elements) return data;

  const sanitizedElements = data.elements.map((element) => {
    if (!element.customData?.enabledOrigin) return element;
    const { enabledOrigin: _enabledOrigin, ...customData } = element.customData;
    return { ...element, customData };
  });
  const sanitizedData = sanitizedElements.every((element, index) => element === data.elements?.[index])
    ? data
    : { ...data, elements: sanitizedElements };
  if (!sanitizedElements.some(isProtectedCarrier)) return sanitizedData;

  const currentNodeKeys = collectNodeKeys(currentElements);
  const pastedNodeKeys = [...collectNodeKeys(sanitizedElements.filter(isProtectedCarrier))];
  if (pastedNodeKeys.length === 0) return false;
  if (pastedNodeKeys.every((nodeKey) => currentNodeKeys.has(nodeKey))) return sanitizedData;

  const nodeKeyMap = await rebind(pastedNodeKeys);
  // oxlint-disable-next-line oxc/no-map-spread -- Excalidraw elements are immutable.
  const elements = sanitizedElements.map((element) => {
    if (!isProtectedCarrier(element)) {
      return element;
    }
    const nodeKey = getNodeKey(element);
    const reboundNodeKey = nodeKey ? nodeKeyMap[nodeKey] : undefined;
    if (!reboundNodeKey) throw new Error("Work Map paste rebinding was incomplete");
    return {
      ...element,
      link: createNodeCarrierLink(reboundNodeKey),
      customData: { ...element.customData, nodeKey: reboundNodeKey },
    };
  });
  return { ...data, elements };
};
