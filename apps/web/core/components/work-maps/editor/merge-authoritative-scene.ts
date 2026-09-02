/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { getSyncableElements, reconcileElements, restoreElements } from "@excalidraw/excalidraw";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { TWorkMapFiles } from "@plane/types";
import { decodeScene, encodeScene } from "./scene";

export const mergeAuthoritativeScene = (
  localScene: string,
  authoritativeScene: string,
  appState: AppState
): { elements: OrderedExcalidrawElement[]; files: TWorkMapFiles; sceneBinary: string } => {
  const local = decodeScene(localScene);
  const authoritative = decodeScene(authoritativeScene);
  const localElements = restoreElements(local.elements, null);
  const authoritativeElements = restoreElements(authoritative.elements, null) as RemoteExcalidrawElement[];
  const elements = reconcileElements(localElements, authoritativeElements, appState);
  const files = { ...authoritative.files, ...local.files };
  return { elements, files, sceneBinary: encodeScene({ elements: getSyncableElements(elements), files }) };
};
