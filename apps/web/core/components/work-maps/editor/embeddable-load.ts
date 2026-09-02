/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import { getNodeKey, isAllowedEmbedUrl, isNodeCarrierLink } from "./scene";

export const isEmbeddableLinkAllowed = (link: string): boolean => isNodeCarrierLink(link) || isAllowedEmbedUrl(link);

export const getEmbeddableOrigin = (element: Pick<ExcalidrawEmbeddableElement, "link">): string | null => {
  if (!element.link) return null;
  try {
    const url = new URL(element.link);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

export const isDocumentEmbeddableEnabled = (
  element: Pick<ExcalidrawEmbeddableElement, "link" | "customData">
): boolean => {
  if (typeof element.customData?.nodeKey === "string") return false;
  const origin = getEmbeddableOrigin(element);
  return !!origin && element.customData?.enabledOrigin === origin;
};

export const enableDocumentEmbeddable = <T extends Pick<ExcalidrawEmbeddableElement, "link" | "customData">>(
  element: T
): T => {
  if (typeof element.customData?.nodeKey === "string") return element;
  const origin = getEmbeddableOrigin(element);
  if (!origin) return element;
  return { ...element, customData: { ...element.customData, enabledOrigin: origin } };
};

export const getViewerEmbeddableKey = (
  element: Pick<ExcalidrawEmbeddableElement, "id" | "link" | "customData">
): string | null => {
  if (typeof element.customData?.nodeKey === "string") return null;
  const origin = getEmbeddableOrigin(element);
  return origin ? `${element.id}:${origin}` : null;
};

export const shouldLoadEmbeddableContent = (
  element: ExcalidrawEmbeddableElement,
  viewerEnablement: ReadonlySet<string>
): boolean => {
  if (getNodeKey(element)) return true;
  if (isDocumentEmbeddableEnabled(element)) return true;
  const viewerKey = getViewerEmbeddableKey(element);
  return !!viewerKey && viewerEnablement.has(viewerKey);
};
