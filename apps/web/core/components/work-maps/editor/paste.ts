/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ClipboardData } from "@excalidraw/excalidraw/clipboard";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { getNodeKey, isNodeCarrierLink } from "./scene";

const isProtectedCarrier = (element: ExcalidrawElement) =>
  element.type === "embeddable" &&
  (typeof element.customData?.nodeKey === "string" || (!!element.link && isNodeCarrierLink(element.link)));

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
