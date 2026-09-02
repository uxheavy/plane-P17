/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { readRecovery } from "./recovery";

afterEach(() => vi.unstubAllGlobals());

describe("Work Map recovery boundary", () => {
  it("rejects and clears a negative base generation", () => {
    const values = new Map([
      ["work-map-recovery:user-id:map-id", JSON.stringify({ generation: -1, scene_binary: "scene" })],
    ]);
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
      },
    });
    expect(readRecovery("user-id", "map-id")).toBeNull();
    expect(values.size).toBe(0);
  });
});
