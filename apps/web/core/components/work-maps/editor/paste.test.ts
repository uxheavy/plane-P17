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
import type { ClipboardData } from "@excalidraw/excalidraw/clipboard";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { rebindProtectedPaste } from "./paste";

const carrier = (nodeKey: string) =>
  ({
    id: nodeKey,
    type: "embeddable",
    link: `https://work-map.invalid/nodes/${nodeKey}`,
    customData: { nodeKey },
  }) as unknown as ExcalidrawElement;

describe("Work Map protected paste", () => {
  it("leaves non-element native clipboard data unchanged", async () => {
    const data: ClipboardData = { text: "native paste" };
    expect(await rebindProtectedPaste(data, [], async () => ({}))).toBe(data);
  });

  it("keeps same-map Plane carriers on the native insertion path", async () => {
    const nodeKey = "d0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const data: ClipboardData = { elements: [carrier(nodeKey)] };
    expect(await rebindProtectedPaste(data, [carrier(nodeKey)], async () => ({}))).toBe(data);
  });

  it("removes document-scoped enablement from native clipboard paste", async () => {
    const element = {
      id: "url-embed",
      type: "embeddable",
      link: "https://source.example/embed",
      customData: { enabledOrigin: "https://source.example" },
    } as unknown as ExcalidrawElement;
    const result = await rebindProtectedPaste({ elements: [element] }, [], async () => ({}));
    if (!result || !result.elements) throw new Error("Expected sanitized paste data");
    expect(result.elements[0]?.customData).toEqual({});
  });

  it("rebinds protected carriers and removes source-only embed state", async () => {
    const sourceKey = "d0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const targetKey = "f0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const element = {
      ...carrier(sourceKey),
      customData: { nodeKey: sourceKey, enabledOrigin: "https://source.example" },
    } as ExcalidrawElement;
    const urlEmbed = {
      id: "url-embed",
      type: "embeddable",
      link: "https://source.example/embed",
      customData: { enabledOrigin: "https://source.example" },
    } as unknown as ExcalidrawElement;
    const result = await rebindProtectedPaste({ elements: [element, urlEmbed] }, [], async (nodeKeys) => ({
      [nodeKeys[0] as string]: targetKey,
    }));
    if (!result || !result.elements) throw new Error("Expected rebound paste data");
    expect(result.elements[0]?.customData).toEqual({ nodeKey: targetKey });
    expect(result.elements[0]?.link).toBe(`https://work-map.invalid/nodes/${targetKey}`);
    expect(result.elements[1]?.customData).toEqual({});
  });
});
