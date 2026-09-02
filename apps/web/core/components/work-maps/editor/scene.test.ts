/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { TWorkMapFiles } from "@plane/types";
import {
  createNodeCarrierLink,
  decodeScene,
  encodeScene,
  getNodeKey,
  isAllowedEmbedUrl,
  isGenerationConflict,
  isNodeCarrierLink,
} from "./scene";

describe("Work Map scene boundary", () => {
  it("accepts only web embed URLs", () => {
    expect(isAllowedEmbedUrl("https://example.com/path")).toBe(true);
    expect(isAllowedEmbedUrl("http://127.0.0.1:8080/frame")).toBe(true);
    expect(isAllowedEmbedUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedEmbedUrl("not a URL")).toBe(false);
  });

  it("creates and recognizes only closed native carrier links", () => {
    const nodeKey = "d0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const link = createNodeCarrierLink(nodeKey);
    expect(link).toBe(`https://work-map.invalid/nodes/${nodeKey}`);
    expect(isNodeCarrierLink(link)).toBe(true);
    expect(isNodeCarrierLink("https://work-map.invalid/nodes/not-a-node-key")).toBe(false);
  });

  it("round-trips native scene bytes with only the opaque node key", () => {
    const nodeKey = "d0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const element = {
      id: "carrier",
      type: "embeddable",
      customData: { nodeKey, source_id: "must-not-survive", source_kind: "work-item" },
    } as unknown as ExcalidrawElement;
    const encoded = encodeScene({ elements: [element], files: {} });
    const decoded = decodeScene(encoded);
    expect(getNodeKey(decoded.elements[0])).toBe(nodeKey);
    expect(atob(encoded)).not.toContain("source_id");
    expect(atob(encoded)).not.toContain("source_kind");
    expect(atob(encoded)).not.toContain("must-not-survive");
  });

  it("rejects viewer-local asset bytes at the durable scene boundary", () => {
    const encoded = btoa(
      JSON.stringify({
        elements: [],
        files: {
          image: {
            assetId: "d0f238c8-1c14-4f6c-a695-70d087bb8db0",
            mimeType: "image/png",
            created: 1,
            dataURL: "data:image/png;base64,unsafe",
          },
        },
      })
    );
    expect(() => decodeScene(encoded)).toThrow("Invalid Work Map file");
  });

  it("serializes only the closed Plane asset metadata", () => {
    const encoded = encodeScene({
      elements: [],
      files: {
        image: {
          assetId: "d0f238c8-1c14-4f6c-a695-70d087bb8db0",
          mimeType: "image/png",
          created: 1,
          dataURL: "data:image/png;base64,unsafe",
        },
      } as unknown as TWorkMapFiles,
    });
    expect(atob(encoded)).not.toContain("dataURL");
    expect(decodeScene(encoded).files.image).toEqual({
      assetId: "d0f238c8-1c14-4f6c-a695-70d087bb8db0",
      mimeType: "image/png",
      created: 1,
    });
  });

  it("retries only generation conflicts", () => {
    expect(isGenerationConflict({ response: { status: 409 } })).toBe(true);
    expect(isGenerationConflict({ response: { status: 403 } })).toBe(false);
    expect(isGenerationConflict(new Error("offline"))).toBe(false);
  });
});
