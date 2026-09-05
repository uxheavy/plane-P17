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
import { getCurrentInvalidatedNodeKeys, parseSourceInvalidationFrame } from "./source-invalidation";

describe("Work map source invalidation boundary", () => {
  it("deduplicates the closed opaque-key frame", () => {
    expect(
      parseSourceInvalidationFrame({
        type: "SOURCE_PROJECTIONS_INVALIDATED",
        payload: { nodeKeys: ["node-a", "node-a", "node-b"] },
      })
    ).toEqual(["node-a", "node-b"]);
  });

  it("rejects source metadata in place of opaque node keys", () => {
    expect(() =>
      parseSourceInvalidationFrame({
        type: "SOURCE_PROJECTIONS_INVALIDATED",
        payload: { nodeKeys: [{ source_id: "source" }] },
      })
    ).toThrow("Invalid source invalidation frame");
  });

  it("rejects more than 100 opaque keys", () => {
    expect(() =>
      parseSourceInvalidationFrame({
        type: "SOURCE_PROJECTIONS_INVALIDATED",
        payload: { nodeKeys: Array.from({ length: 101 }, (_, index) => `node-${index}`) },
      })
    ).toThrow("Invalid source invalidation frame");
  });

  it("ignores keys that are not in the current scene", () => {
    expect(getCurrentInvalidatedNodeKeys(["node-a", "node-b"], ["unknown", "node-b"])).toEqual(["node-b"]);
  });
});
