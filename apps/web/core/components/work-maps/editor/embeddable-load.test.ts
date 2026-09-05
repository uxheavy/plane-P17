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

describe("Work map embeddable load ownership", () => {
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

  it("keeps URL embed lifecycle independent from Plane node carriers", () => {
    const element = embeddable("embed", "https://example.com/first");
    expect(isEmbeddableLinkAllowed(element.link ?? "")).toBe(true);
    expect(enableDocumentEmbeddable(element)).not.toBe(element);
    expect(getViewerEmbeddableKey(element)).toBe("embed:https://example.com");
    expect(shouldLoadEmbeddableContent(element, new Set())).toBe(false);
  });
});
