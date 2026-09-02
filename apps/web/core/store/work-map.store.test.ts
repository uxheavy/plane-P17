/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import type { TWorkMapHydration } from "@plane/types";
import type { WorkMapService } from "@/services/work-map.service";
import { WorkMapStore } from "./work-map.store";

const available = (nodeKey: string): TWorkMapHydration => ({
  node_key: nodeKey,
  available: true,
  revision: 1,
  source: {
    source_kind: "page",
    source_id: `${nodeKey}-source`,
    project_id: "project-id",
    name: nodeKey,
  },
});

describe("Work Map source hydration", () => {
  it("settles fast projections without waiting for a delayed sibling", async () => {
    const store = new WorkMapStore();
    let releaseSlow: (() => void) | undefined;
    const slow = new Promise<void>((resolve) => (releaseSlow = resolve));
    store.service = {
      hydrate: vi.fn(async (_workspaceSlug, _projectId, _workMapId, [nodeKey]: string[]) => {
        if (nodeKey === "slow") await slow;
        return [available(nodeKey)];
      }),
    } as unknown as WorkMapService;

    const hydration = store.hydrate("workspace", "project", "map", ["slow", "fast-a", "fast-b"]);
    await vi.waitFor(() => {
      expect(store.projections["fast-a"]?.available).toBe(true);
      expect(store.projections["fast-b"]?.available).toBe(true);
    });
    expect(store.projections.slow).toBeUndefined();

    releaseSlow?.();
    await hydration;
    expect(store.projections.slow?.available).toBe(true);
  });

  it("fail-closes only the projection whose request fails", async () => {
    const store = new WorkMapStore();
    store.service = {
      hydrate: vi.fn(async (_workspaceSlug, _projectId, _workMapId, [nodeKey]: string[]) => {
        if (nodeKey === "failed") throw new Error("transport failed");
        return [available(nodeKey)];
      }),
    } as unknown as WorkMapService;

    await store.hydrate("workspace", "project", "map", ["failed", "available"]);
    expect(store.projections.failed).toEqual({ node_key: "failed", available: false });
    expect(store.projections.available?.available).toBe(true);
  });

  it("keeps the 100-node supported envelope within eight concurrent requests", async () => {
    const store = new WorkMapStore();
    let inFlight = 0;
    let maxInFlight = 0;
    const hydrate = vi.fn(async (_workspaceSlug, _projectId, _workMapId, [nodeKey]: string[]) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return [available(nodeKey)];
    });
    store.service = { hydrate } as unknown as WorkMapService;
    const nodeKeys = Array.from({ length: 100 }, (_, index) => `node-${index}`);

    await store.hydrate("workspace", "project", "map", nodeKeys);
    expect(hydrate).toHaveBeenCalledTimes(100);
    expect(maxInFlight).toBe(8);
    expect(Object.keys(store.projections)).toHaveLength(100);
  });

  it("does not let an older request overwrite a later invalidation", async () => {
    const store = new WorkMapStore();
    let release: (() => void) | undefined;
    const delayed = new Promise<void>((resolve) => (release = resolve));
    store.service = {
      hydrate: vi.fn(async () => {
        await delayed;
        return [available("node")];
      }),
    } as unknown as WorkMapService;

    const hydration = store.hydrate("workspace", "project", "map", ["node"]);
    store.invalidate(["node"]);
    release?.();
    await hydration;
    expect(store.projections.node).toEqual({ node_key: "node", available: false });
  });
});
