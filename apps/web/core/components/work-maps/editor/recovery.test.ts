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
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("navigator", {});
    return values;
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
});
