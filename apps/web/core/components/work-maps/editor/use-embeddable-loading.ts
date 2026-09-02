/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { enableDocumentEmbeddable, getViewerEmbeddableKey, isDocumentEmbeddableEnabled } from "./embeddable-load";

export const useEmbeddableLoading = (api: ExcalidrawImperativeAPI | null, editable: boolean) => {
  const viewerEnablementRef = useRef(new Set<string>());

  useEffect(() => {
    if (editable) viewerEnablementRef.current.clear();
  }, [editable]);

  const shouldLoadEmbeddable = useCallback((element: ExcalidrawEmbeddableElement) => {
    if (isDocumentEmbeddableEnabled(element)) return true;
    const viewerKey = getViewerEmbeddableKey(element);
    return !!viewerKey && viewerEnablementRef.current.has(viewerKey);
  }, []);

  const onEmbeddableLoadRequest = useCallback(
    (element: ExcalidrawEmbeddableElement) => {
      const viewerKey = getViewerEmbeddableKey(element);
      if (!viewerKey) return;

      if (!editable) {
        const keyPrefix = `${element.id}:`;
        for (const key of viewerEnablementRef.current) {
          if (key.startsWith(keyPrefix)) viewerEnablementRef.current.delete(key);
        }
        viewerEnablementRef.current.add(viewerKey);
        return;
      }

      if (!api || isDocumentEmbeddableEnabled(element)) return;
      api.updateScene({
        elements: api
          .getSceneElementsIncludingDeleted()
          .map((candidate) =>
            candidate.id === element.id && candidate.type === "embeddable"
              ? enableDocumentEmbeddable(candidate)
              : candidate
          ),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [api, editable]
  );

  return { shouldLoadEmbeddable, onEmbeddableLoadRequest };
};
