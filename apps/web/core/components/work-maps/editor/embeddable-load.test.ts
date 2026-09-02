/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import {
  enableDocumentEmbeddable,
  getViewerEmbeddableKey,
  isEmbeddableLinkAllowed,
  isDocumentEmbeddableEnabled,
  shouldLoadEmbeddableContent,
} from "./embeddable-load";

const embeddable = (id: string, link: string, enabledOrigin?: string) =>
  ({
    id,
    type: "embeddable",
    link,
    customData: enabledOrigin ? { enabledOrigin } : undefined,
  }) as ExcalidrawEmbeddableElement;

describe("Work Map embeddable load ownership", () => {
  it("keeps same-origin path changes enabled and resets on origin changes", () => {
    const enabled = enableDocumentEmbeddable(embeddable("embed", "https://example.com/first"));
    expect(isDocumentEmbeddableEnabled({ ...enabled, link: "https://example.com/second?view=1" })).toBe(true);
    expect(isDocumentEmbeddableEnabled({ ...enabled, link: "https://other.example/second" })).toBe(false);
  });

  it("scopes temporary viewer enablement to the element and current origin", () => {
    expect(getViewerEmbeddableKey("map-a", embeddable("embed-a", "https://example.com/first"))).toBe(
      "map-a:embed-a:https://example.com"
    );
    expect(getViewerEmbeddableKey("map-a", embeddable("embed-b", "javascript:alert(1)"))).toBeNull();
    expect(
      shouldLoadEmbeddableContent(
        "map-b",
        embeddable("embed-a", "https://example.com/first"),
        new Set(["map-a:embed-a:https://example.com"])
      )
    ).toBe(false);
  });

  it("never treats a protected Plane carrier as a URL embed", () => {
    const nodeKey = "d0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const carrier = {
      ...embeddable("node", `https://work-map.invalid/nodes/${nodeKey}`),
      customData: { nodeKey },
    };
    expect(isDocumentEmbeddableEnabled(carrier)).toBe(false);
    expect(isEmbeddableLinkAllowed(carrier.link ?? "")).toBe(true);
    expect(enableDocumentEmbeddable(carrier)).toBe(carrier);
    expect(getViewerEmbeddableKey("map-a", carrier)).toBeNull();
    expect(shouldLoadEmbeddableContent("map-a", carrier, new Set())).toBe(true);
  });
});
