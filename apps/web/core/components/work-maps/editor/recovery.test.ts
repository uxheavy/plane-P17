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
import {
  createRecoveryWriter,
  readRecovery,
  recoveryTtlMs,
  revokeRecoveryWriters,
  withRecoveryWriterLock,
} from "@/services/work-map-recovery.service";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const recoveryScene = (value: string) => btoa(JSON.stringify({ value }));

describe("Work map recovery boundary", () => {
  const installStorage = (initial: Record<string, string> = {}) => {
    const values = new Map(Object.entries(initial));
    const localStorage = {
      get length() {
        return values.size;
      },
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    vi.stubGlobal("window", { localStorage, setTimeout, clearTimeout });
    vi.stubGlobal("navigator", {});
    return values;
  };

  const installPersistenceMocks = (
    record: Record<string, unknown>,
    values: Map<string, string>,
    recoveryKey: string,
    clearOnReplay = true
  ) => {
    vi.resetModules();
    const stateSetter = vi.fn();
    vi.doMock("react", () => ({
      useCallback: (callback: unknown) => callback,
      useEffect: () => undefined,
      useMemo: (factory: () => unknown) => factory(),
      useRef: (current: unknown) => ({ current }),
      useState: (initial: unknown) => [
        typeof initial === "function" ? (initial as () => unknown)() : initial,
        stateSetter,
      ],
    }));
    vi.doMock("./merge-authoritative-scene", () => ({
      mergeAuthoritativeScene: (sceneBinary: string) => ({ sceneBinary, elements: [], files: {} }),
    }));
    vi.doMock("@/services/work-map.service", () => ({
      WorkMapService: class WorkMapService {
        fetchScene() {
          return Promise.resolve({
            collaboration_epoch: 2,
            generation: 2,
            scene_binary: recoveryScene("authoritative"),
          });
        }
        saveScene() {
          return Promise.resolve({ generation: 3 });
        }
      },
    }));
    vi.doMock("@/services/work-map-recovery.service", () => {
      const records = [record];
      return {
        readRecovery: () => records.slice(),
        createRecoveryWriter: () => ({
          writerId: "current-writer",
          isReady: () => true,
          whenReady: () => Promise.resolve(true),
          activate: () => undefined,
          retain: () => null,
          clear: () => undefined,
          release: () => undefined,
          revoke: () => undefined,
        }),
        clearRecoverySlot: (_accountId: string, _workMapId: string, writerId: string) => {
          if (clearOnReplay && writerId === record.writerId) {
            records.length = 0;
            values.delete(recoveryKey);
          }
        },
        withRecoveryWriterLock: async (
          _accountId: string,
          _workMapId: string,
          _writerId: string,
          callback: () => Promise<unknown>
        ) => callback(),
      };
    });
    return stateSetter;
  };

  it("rejects and clears a negative base generation", () => {
    const values = installStorage({
      "work-map-recovery:user-id:map-id:writer": JSON.stringify({ generation: -1, scene_binary: recoveryScene("bad") }),
    });
    expect(readRecovery("user-id", "map-id")).toEqual([]);
    expect(values.size).toBe(0);
  });

  it("keeps exact bytes and does not renew a slot's 24-hour expiry", () => {
    installStorage();
    vi.stubGlobal("crypto", { randomUUID: () => "writer-a" });
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const writer = createRecoveryWriter({ accountId: "user-id", workMapId: "map-id" });
    const first = writer.retain(3, recoveryScene("first"), 4);
    vi.setSystemTime(20_000);
    const second = writer.retain(3, recoveryScene("second"));
    expect(second).toMatchObject({
      scene_binary: recoveryScene("second"),
      collaboration_epoch: 4,
      writtenAt: first?.writtenAt,
      expiresAt: 10_000 + recoveryTtlMs,
    });
    expect(readRecovery("user-id", "map-id")[0]).toMatchObject({ collaboration_epoch: 4 });
    writer.release();
    vi.useRealTimers();
  });

  it("expires a slot without renewing it during reads", () => {
    installStorage();
    vi.stubGlobal("crypto", { randomUUID: () => "writer-a" });
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const writer = createRecoveryWriter({ accountId: "user-id", workMapId: "map-id" });
    writer.retain(3, recoveryScene("first"));
    vi.setSystemTime(10_000 + recoveryTtlMs);
    expect(writer.retain(3, recoveryScene("late"))).toBeNull();
    expect(readRecovery("user-id", "map-id")).toEqual([]);
    writer.release();
  });

  it("does not write after release until the mounted owner activates again", () => {
    installStorage();
    vi.stubGlobal("crypto", { randomUUID: () => "writer-a" });
    const writer = createRecoveryWriter({ accountId: "user-id", workMapId: "map-id" });
    expect(writer.retain(1, recoveryScene("before-release"))).not.toBeNull();
    writer.release();
    expect(readRecovery("user-id", "map-id")).toHaveLength(1);
    writer.clear();
    expect(readRecovery("user-id", "map-id")).toEqual([]);
    expect(writer.retain(1, recoveryScene("late"))).toBeNull();
    writer.activate();
    expect(writer.retain(1, recoveryScene("active"))).not.toBeNull();
    revokeRecoveryWriters("user-id");
    expect(writer.retain(1, recoveryScene("revoked"))).toBeNull();
    writer.activate();
    expect(writer.retain(1, recoveryScene("resurrected"))).toBeNull();
  });

  it("holds the native writer lock until release before allowing recovery replay", async () => {
    installStorage();
    vi.stubGlobal("crypto", { randomUUID: () => "writer-a" });
    const held = new Set<string>();
    vi.stubGlobal("navigator", {
      locks: {
        request: vi.fn(
          async (name: string, options: { ifAvailable?: boolean }, callback: (lock: object | null) => unknown) => {
            if (held.has(name)) return callback(options.ifAvailable ? null : {});
            held.add(name);
            try {
              return await callback({});
            } finally {
              held.delete(name);
            }
          }
        ),
      },
    });
    const writer = createRecoveryWriter({ accountId: "user-id", workMapId: "map-id" });
    expect(writer.isReady()).toBe(true);
    writer.retain(1, recoveryScene("active"));
    await expect(
      withRecoveryWriterLock("user-id", "map-id", "writer-a", async () => "replayed", true)
    ).resolves.toEqual({ acquired: false });
    writer.release();
    await expect(withRecoveryWriterLock("user-id", "map-id", "writer-a", async () => "replayed")).resolves.toEqual({
      acquired: true,
      value: "replayed",
    });
  });

  it("rejects recovery bytes above the existing 3 MiB decoded cap", () => {
    installStorage();
    vi.stubGlobal("crypto", { randomUUID: () => "writer-a" });
    const writer = createRecoveryWriter({ accountId: "user-id", workMapId: "map-id" });
    const oversizedScene = "A".repeat(4_194_308);
    expect(() => writer.retain(1, oversizedScene)).toThrow(/3 MiB/);
    expect(readRecovery("user-id", "map-id")).toEqual([]);
    writer.release();
  });

  it("keeps concurrent writer slots separate and revokes only the account", () => {
    installStorage();
    const ids = ["writer-a", "writer-b", "writer-other", "epoch"];
    vi.stubGlobal("crypto", { randomUUID: () => ids.shift() ?? "fallback" });
    const first = createRecoveryWriter({ accountId: "user-id", workMapId: "map-id" });
    const second = createRecoveryWriter({ accountId: "user-id", workMapId: "map-id" });
    const other = createRecoveryWriter({ accountId: "other-user", workMapId: "map-id" });
    first.retain(1, recoveryScene("a"));
    second.retain(1, recoveryScene("b"));
    other.retain(1, recoveryScene("other"));
    expect(readRecovery("user-id", "map-id")).toHaveLength(2);
    revokeRecoveryWriters("user-id");
    expect(first.retain(1, recoveryScene("late"))).toBeNull();
    expect(readRecovery("user-id", "map-id")).toEqual([]);
    expect(readRecovery("other-user", "map-id")).toHaveLength(1);
    other.release();
  });

  it("rebases a retained same-epoch journal after the server generation advances", async () => {
    vi.useFakeTimers();
    const writtenAt = Date.now();
    const recoveryKey = "work-map-recovery:user-id:map-id:writer";
    const record = {
      generation: 1,
      collaboration_epoch: 2,
      scene_binary: recoveryScene("pending"),
      writtenAt,
      expiresAt: writtenAt + recoveryTtlMs,
      writerId: "writer",
    };
    const values = installStorage({ [recoveryKey]: JSON.stringify(record) });
    installPersistenceMocks(record, values, recoveryKey);

    try {
      const [{ usePersistence }, { WorkMapService }] = await Promise.all([
        import("./use-persistence"),
        import("@/services/work-map.service"),
      ]);
      vi.spyOn(WorkMapService.prototype, "fetchScene")
        .mockResolvedValueOnce({ collaboration_epoch: 2, generation: 2, scene_binary: recoveryScene("authoritative") })
        .mockResolvedValueOnce({ collaboration_epoch: 2, generation: 3, scene_binary: recoveryScene("merged") });
      const saveScene = vi.spyOn(WorkMapService.prototype, "saveScene").mockResolvedValue({ generation: 3 });
      const persistence = usePersistence(
        { workspaceSlug: "workspace", projectId: "project", workMapId: "map", userId: "user-id" },
        {
          generationRef: { current: 2 },
          collaborationEpochRef: { current: 2 },
          durableSceneRef: { current: recoveryScene("authoritative") },
          getAppState: () => ({}) as never,
          applyRemoteScene: vi.fn().mockResolvedValue(undefined),
          applyAuthoritativeScene: vi.fn().mockResolvedValue(undefined),
        }
      );

      persistence.evaluateRecovery(true);
      await persistence.retryRecovery("writer", true);

      expect(saveScene).toHaveBeenCalledTimes(1);
      expect(saveScene.mock.calls[0]?.[3]).toMatchObject({ collaboration_epoch: 2, generation: 2 });
      expect(values.has(recoveryKey)).toBe(false);
    } finally {
      vi.doUnmock("react");
      vi.doUnmock("./merge-authoritative-scene");
      vi.doUnmock("@/services/work-map.service");
      vi.doUnmock("@/services/work-map-recovery.service");
      vi.resetModules();
    }
  });

  it("keeps a missing-epoch journal blocked after permission is restored", async () => {
    vi.useFakeTimers();
    const writtenAt = Date.now();
    const recoveryKey = "work-map-recovery:user-id:map-id:writer";
    const record = {
      generation: 1,
      scene_binary: recoveryScene("legacy"),
      writtenAt,
      expiresAt: writtenAt + recoveryTtlMs,
      writerId: "writer",
    };
    const values = installStorage({ [recoveryKey]: JSON.stringify(record) });
    const stateSetter = installPersistenceMocks(record, values, recoveryKey, false);

    try {
      const [{ usePersistence }, { WorkMapService }] = await Promise.all([
        import("./use-persistence"),
        import("@/services/work-map.service"),
      ]);
      vi.spyOn(WorkMapService.prototype, "fetchScene");
      const saveScene = vi.spyOn(WorkMapService.prototype, "saveScene");
      const persistence = usePersistence(
        { workspaceSlug: "workspace", projectId: "project", workMapId: "map", userId: "user-id" },
        {
          generationRef: { current: 2 },
          collaborationEpochRef: { current: 2 },
          durableSceneRef: { current: recoveryScene("authoritative") },
          getAppState: () => ({}) as never,
          applyRemoteScene: vi.fn().mockResolvedValue(undefined),
          applyAuthoritativeScene: vi.fn().mockResolvedValue(undefined),
        }
      );

      await persistence.retryRecovery("writer", false);
      await persistence.retryRecovery("writer", true);

      expect(saveScene).not.toHaveBeenCalled();
      expect(values.has(recoveryKey)).toBe(true);
      const stateUpdates = stateSetter.mock.calls.map(([update]) =>
        typeof update === "function" ? update({}) : update
      );
      expect(stateUpdates).toContainEqual({ writer: { status: "non-replayable", reason: "authority-mismatch" } });
    } finally {
      vi.doUnmock("react");
      vi.doUnmock("./merge-authoritative-scene");
      vi.doUnmock("@/services/work-map.service");
      vi.doUnmock("@/services/work-map-recovery.service");
      vi.resetModules();
    }
  });
});
