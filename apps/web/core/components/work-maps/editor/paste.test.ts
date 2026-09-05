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
import type { TWorkMapRuntimeFiles } from "./scene";

const carrier = (nodeKey: string) =>
  ({
    id: nodeKey,
    type: "rectangle",
    customData: { nodeKey },
  }) as unknown as ExcalidrawElement;

describe("Work map protected paste", () => {
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
    const sourceAssetId = "a0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const targetAssetId = "b0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const currentAssetId = "c0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const element = {
      ...carrier(sourceKey),
      customData: { nodeKey: sourceKey, enabledOrigin: "https://source.example" },
    } as ExcalidrawElement;
    const image = { id: "image-element", type: "image", fileId: "image" } as unknown as ExcalidrawElement;
    let reboundFiles: unknown;
    const result = await rebindProtectedPaste(
      {
        elements: [element, image],
        files: {
          image: {
            id: "image",
            mimeType: "image/png",
            created: 1,
            dataURL: "data:image/png;base64,unsafe",
            assetId: sourceAssetId,
          },
        },
      } as unknown as ClipboardData,
      [],
      async (nodeKeys, files) => {
        reboundFiles = files;
        return { node_keys: { [nodeKeys[0] as string]: targetKey }, files: { image: targetAssetId } };
      },
      {
        image: {
          id: "image",
          mimeType: "image/png",
          created: 1,
          dataURL: "data:image/png;base64,target-bytes",
          assetId: currentAssetId,
        },
      } as unknown as TWorkMapRuntimeFiles
    );
    if (!result || !result.elements) throw new Error("Expected rebound paste data");
    expect(reboundFiles).toEqual({
      image: { assetId: sourceAssetId, mimeType: "image/png", created: 1 },
    });
    expect(result.elements[0]?.customData).toEqual({ nodeKey: targetKey });
    expect(result.elements[0]).not.toHaveProperty("link");
    expect(result.files?.image).toBeUndefined();
    const reboundImage = result.elements[1] as ExcalidrawElement & { fileId?: string };
    expect(reboundImage.fileId).not.toBe("image");
    expect(result.files?.[reboundImage.fileId as string]).toMatchObject({
      id: reboundImage.fileId,
      assetId: targetAssetId,
      dataURL: "data:image/png;base64,unsafe",
    });
  });
});
