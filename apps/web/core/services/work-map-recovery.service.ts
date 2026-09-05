/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

const RECOVERY_PREFIX = "work-map-recovery";
const EPOCH_PREFIX = "work-map-recovery-epoch";
const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DECODED_SCENE_BYTES = 3 * 1024 * 1024;

export type TRecoveryScope = { accountId: string; workMapId: string };

export type TRecoveryRecord = {
  generation: number;
  collaboration_epoch?: number;
  scene_binary: string;
  writtenAt: number;
  expiresAt: number;
  writerId: string;
};

export type TRecoveryWriter = {
  readonly writerId: string;
  activate: () => void;
  retain: (generation: number, sceneBinary: string, collaborationEpoch?: number) => TRecoveryRecord | null;
  clear: () => void;
  release: () => void;
  revoke: () => void;
};

const encodeSegment = (value: string) => encodeURIComponent(value);
const accountPrefix = (accountId: string) => `${RECOVERY_PREFIX}:${encodeSegment(accountId)}:`;
const mapPrefix = ({ accountId, workMapId }: TRecoveryScope) =>
  `${accountPrefix(accountId)}${encodeSegment(workMapId)}:`;
const epochKey = (accountId: string) => `${EPOCH_PREFIX}:${encodeSegment(accountId)}`;

type TLockManager = {
  request: <T>(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: object | null) => Promise<T> | T
  ) => Promise<T>;
};

const lockManager = (): TLockManager | null => {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return null;
  return (navigator as Navigator & { locks: TLockManager }).locks;
};

const writerLockName = ({ accountId, workMapId, writerId }: TRecoveryScope & { writerId: string }) =>
  `${RECOVERY_PREFIX}-lock:${encodeSegment(accountId)}:${encodeSegment(workMapId)}:${encodeSegment(writerId)}`;

const storage = (): Storage => {
  if (typeof window === "undefined") throw new Error("Work map recovery storage is unavailable");
  return window.localStorage;
};

const keys = (store: Storage): string[] => {
  const result: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key) result.push(key);
  }
  return result;
};

const decodedByteLength = (value: string): number => {
  if (
    !value ||
    value.length % 4 === 1 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw new Error("Invalid Work map recovery scene");
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const size = (value.length * 3) / 4 - padding;
  if (size > MAX_DECODED_SCENE_BYTES) throw new Error("Work map recovery scene exceeds the 3 MiB limit");
  return size;
};

const validateRecord = (value: unknown, now: number): TRecoveryRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Work map recovery record");
  const record = value as Record<string, unknown>;
  if (
    typeof record.generation !== "number" ||
    !Number.isInteger(record.generation) ||
    record.generation < 0 ||
    typeof record.scene_binary !== "string" ||
    typeof record.writtenAt !== "number" ||
    !Number.isInteger(record.writtenAt) ||
    record.writtenAt < 0 ||
    typeof record.expiresAt !== "number" ||
    !Number.isInteger(record.expiresAt) ||
    record.expiresAt !== record.writtenAt + RECOVERY_TTL_MS ||
    typeof record.writerId !== "string" ||
    !record.writerId
  )
    throw new Error("Invalid Work map recovery record");
  if (
    record.collaboration_epoch !== undefined &&
    (typeof record.collaboration_epoch !== "number" ||
      !Number.isInteger(record.collaboration_epoch) ||
      record.collaboration_epoch < 0)
  )
    throw new Error("Invalid Work map recovery record");
  decodedByteLength(record.scene_binary);
  if (record.expiresAt <= now) return null;
  return {
    generation: record.generation,
    ...(typeof record.collaboration_epoch === "number" ? { collaboration_epoch: record.collaboration_epoch } : {}),
    scene_binary: record.scene_binary,
    writtenAt: record.writtenAt,
    expiresAt: record.expiresAt,
    writerId: record.writerId,
  };
};

const removeKey = (store: Storage, key: string) => {
  try {
    store.removeItem(key);
  } catch {
    // Expiry cleanup is best effort; a write still reports storage failure.
  }
};

const readEpoch = (store: Storage, accountId: string) => store.getItem(epochKey(accountId)) ?? "0";

const makeWriterId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const values = crypto.getRandomValues(new Uint32Array(3));
    return Array.from(values, (value) => value.toString(36)).join("-");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const writersByAccount = new Map<string, Set<() => void>>();

export const readRecovery = (accountId: string, workMapId: string, now = Date.now()): TRecoveryRecord[] => {
  const store = storage();
  const prefix = mapPrefix({ accountId, workMapId });
  const records: TRecoveryRecord[] = [];
  for (const key of keys(store)) {
    if (!key.startsWith(prefix)) continue;
    const raw = store.getItem(key);
    if (!raw) continue;
    try {
      const record = validateRecord(JSON.parse(raw), now);
      if (record) records.push(record);
      else removeKey(store, key);
    } catch {
      removeKey(store, key);
    }
  }
  records.sort((left, right) => right.writtenAt - left.writtenAt || left.writerId.localeCompare(right.writerId));
  return records;
};

export type TRecoveryLockResult<T> = { acquired: boolean; value?: T };

export const withRecoveryWriterLock = async <T>(
  accountId: string,
  workMapId: string,
  writerId: string,
  callback: () => Promise<T>
): Promise<TRecoveryLockResult<T> | null> => {
  const locks = lockManager();
  if (!locks) return null;
  return locks.request(writerLockName({ accountId, workMapId, writerId }), { ifAvailable: true }, async (lock) => {
    if (!lock) return { acquired: false };
    return { acquired: true, value: await callback() };
  });
};

export const createRecoveryWriter = ({ accountId, workMapId }: TRecoveryScope): TRecoveryWriter => {
  const store = storage();
  const writerId = makeWriterId();
  const epoch = readEpoch(store, accountId);
  const locks = lockManager();
  const lockName = writerLockName({ accountId, workMapId, writerId });
  let revoked = false;
  let registered = true;
  let lockHeld = !locks;
  let releaseLock: (() => void) | undefined;
  let lockRequest: Promise<unknown> | undefined;
  let slotRetention: Pick<TRecoveryRecord, "writtenAt" | "expiresAt" | "collaboration_epoch"> | null = null;
  const revocations = writersByAccount.get(accountId) ?? new Set<() => void>();
  const claimLock = () => {
    if (!locks || revoked || !registered || lockHeld || lockRequest) return;
    lockRequest = locks
      .request(lockName, { ifAvailable: true }, async (lock) => {
        if (!lock || revoked || !registered) return;
        lockHeld = true;
        await new Promise<void>((resolve) => {
          releaseLock = () => {
            lockHeld = false;
            releaseLock = undefined;
            resolve();
          };
        });
      })
      .catch(() => undefined)
      .finally(() => {
        lockRequest = undefined;
      });
  };
  const revoke = () => {
    revoked = true;
    registered = false;
    releaseLock?.();
  };
  const release = () => {
    registered = false;
    revocations.delete(revoke);
    releaseLock?.();
    if (revocations.size === 0) writersByAccount.delete(accountId);
  };
  const activate = () => {
    if (revoked || registered) return;
    revocations.add(revoke);
    writersByAccount.set(accountId, revocations);
    registered = true;
    claimLock();
  };
  revocations.add(revoke);
  writersByAccount.set(accountId, revocations);

  const authorized = () => {
    if (revoked) return false;
    if (readEpoch(store, accountId) !== epoch) {
      revoked = true;
      releaseLock?.();
      return false;
    }
    return true;
  };
  const writable = () => registered && lockHeld && authorized();
  const prefix = mapPrefix({ accountId, workMapId });
  const slotKey = `${prefix}${encodeSegment(writerId)}`;
  claimLock();

  return {
    writerId,
    activate,
    retain: (generation, sceneBinary, collaborationEpoch) => {
      if (!writable()) return null;
      const now = Date.now();
      if (slotRetention && slotRetention.expiresAt <= now) return null;
      const existing =
        slotRetention ?? readRecovery(accountId, workMapId, now).find((record) => record.writerId === writerId) ?? null;
      const record: TRecoveryRecord = {
        generation,
        ...(collaborationEpoch !== undefined || existing?.collaboration_epoch !== undefined
          ? { collaboration_epoch: collaborationEpoch ?? existing?.collaboration_epoch }
          : {}),
        scene_binary: sceneBinary,
        writtenAt: existing?.writtenAt ?? now,
        expiresAt: existing?.expiresAt ?? now + RECOVERY_TTL_MS,
        writerId,
      };
      decodedByteLength(sceneBinary);
      if (record.expiresAt <= now) return null;
      store.setItem(slotKey, JSON.stringify(record));
      slotRetention = {
        writtenAt: record.writtenAt,
        expiresAt: record.expiresAt,
        ...(record.collaboration_epoch !== undefined ? { collaboration_epoch: record.collaboration_epoch } : {}),
      };
      return record;
    },
    clear: () => {
      if (!authorized()) return;
      removeKey(store, slotKey);
      slotRetention = null;
    },
    release,
    revoke: () => {
      revoke();
      release();
    },
  };
};

export const clearRecoverySlot = (accountId: string, workMapId: string, writerId: string): void => {
  const store = storage();
  removeKey(store, `${mapPrefix({ accountId, workMapId })}${encodeSegment(writerId)}`);
};

export const revokeRecoveryWriters = (accountId: string): void => {
  const localWriters = writersByAccount.get(accountId);
  localWriters?.forEach((revoke) => revoke());
  writersByAccount.delete(accountId);
  let store: Storage;
  try {
    store = storage();
    store.setItem(epochKey(accountId), makeWriterId());
  } catch {
    return;
  }
  const prefix = accountPrefix(accountId);
  keys(store)
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => removeKey(store, key));
  const livePrefix = `${LIVE_WRITER_PREFIX}:${encodeSegment(accountId)}:`;
  keys(store)
    .filter((key) => key.startsWith(livePrefix))
    .forEach((key) => removeKey(store, key));
};

export const recoveryTtlMs = RECOVERY_TTL_MS;
