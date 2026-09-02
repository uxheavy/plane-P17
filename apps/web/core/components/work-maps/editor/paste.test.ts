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
import { allowPaste, rebindProtectedPaste } from "./paste";

const carrier = (nodeKey: string) =>
  ({
    id: nodeKey,
    type: "rectangle",
    customData: { nodeKey },
  }) as unknown as ExcalidrawElement;

describe("Work Map protected paste", () => {
  it("leaves native clipboard data unchanged when it has no Plane carriers", () => {
    const data: ClipboardData = { text: "native paste" };
    expect(allowPaste(data, [])).toBe(data);
  });

  it("keeps same-map copy and cut paste on the native insertion path", () => {
    const nodeKey = "d0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const data: ClipboardData = { elements: [carrier(nodeKey)] };
    expect(allowPaste(data, [carrier(nodeKey)])).toBe(data);
  });

  it("fails closed when protected carriers need cross-map key replacement", () => {
    const data: ClipboardData = { elements: [carrier("d0f238c8-1c14-4f6c-a695-70d087bb8db0")] };
    expect(allowPaste(data, [])).toBe(false);
  });

  it("rebinds protected carriers and removes source-only embed state", async () => {
    const sourceKey = "d0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const targetKey = "f0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const element = {
      ...carrier(sourceKey),
      customData: { nodeKey: sourceKey, enabledOrigin: "https://source.example" },
    } as ExcalidrawElement;
    const result = await rebindProtectedPaste({ elements: [element] }, [], async (nodeKeys) => ({
      [nodeKeys[0] as string]: targetKey,
    }));
    if (!result || result === false || !result.elements) throw new Error("Expected rebound paste data");
    expect(result.elements[0]?.customData).toEqual({ nodeKey: targetKey });
    expect(result.elements[0]).not.toHaveProperty("link");
  });
});
