/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import { enableDocumentEmbeddable, getViewerEmbeddableKey, isDocumentEmbeddableEnabled } from "./embeddable-load";

const embeddable = (id: string, link: string, enabledOrigin?: string) =>
  ({ id, link, customData: enabledOrigin ? { enabledOrigin } : undefined }) as ExcalidrawEmbeddableElement;

describe("Work Map embeddable load ownership", () => {
  it("keeps same-origin path changes enabled and resets on origin changes", () => {
    const enabled = enableDocumentEmbeddable(embeddable("embed", "https://example.com/first"));
    expect(isDocumentEmbeddableEnabled({ ...enabled, link: "https://example.com/second?view=1" })).toBe(true);
    expect(isDocumentEmbeddableEnabled({ ...enabled, link: "https://other.example/second" })).toBe(false);
  });

  it("scopes temporary viewer enablement to the element and current origin", () => {
    expect(getViewerEmbeddableKey(embeddable("embed-a", "https://example.com/first"))).toBe(
      "embed-a:https://example.com"
    );
    expect(getViewerEmbeddableKey(embeddable("embed-b", "javascript:alert(1)"))).toBeNull();
  });

  it("never treats a protected Plane carrier as a URL embed", () => {
    const carrier = {
      ...embeddable("node", "https://work-map.invalid/nodes/key"),
      customData: { nodeKey: "key" },
    };
    expect(isDocumentEmbeddableEnabled(carrier)).toBe(false);
    expect(enableDocumentEmbeddable(carrier)).toBe(carrier);
    expect(getViewerEmbeddableKey(carrier)).toBeNull();
  });
});
