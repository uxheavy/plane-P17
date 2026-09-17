/**
 * Copyright (c) 2026-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type TConversationDraftContext = {
  channelId: string;
  rootId: string | null;
  parentId: string | null;
};

export type TConversationDraftSnapshot = {
  text: string;
  context: TConversationDraftContext;
};

export type TConversationDraftEntry = TConversationDraftSnapshot & {
  updatedAt: number;
};

export type TConversationDraftStore = {
  version: 1;
  drafts: Record<string, TConversationDraftEntry>;
};

type TStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_PREFIX = "plane:conversation-drafts:v1";

const emptyStore = (): TConversationDraftStore => ({ version: 1, drafts: {} });

const getBrowserStorage = (): TStorage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const isContext = (value: unknown): value is TConversationDraftContext => {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<TConversationDraftContext>;
  return (
    typeof context.channelId === "string" &&
    (typeof context.rootId === "string" || context.rootId === null) &&
    (typeof context.parentId === "string" || context.parentId === null)
  );
};

const isEntry = (value: unknown): value is TConversationDraftEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<TConversationDraftEntry>;
  return typeof entry.text === "string" && isContext(entry.context) && typeof entry.updatedAt === "number";
};

export const getConversationDraftStorageKey = (workspaceSlug: string, userId: string | null): string | null => {
  if (!workspaceSlug || !userId) return null;
  return `${STORAGE_PREFIX}:${encodeURIComponent(workspaceSlug)}:${encodeURIComponent(userId)}`;
};

export const readConversationDraftStore = (
  storageKey: string | null,
  storage: TStorage | null = getBrowserStorage()
): TConversationDraftStore => {
  if (!storageKey || !storage) return emptyStore();
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return emptyStore();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1) {
      return emptyStore();
    }
    const drafts = (parsed as { drafts?: unknown }).drafts;
    if (!drafts || typeof drafts !== "object") return emptyStore();
    return {
      version: 1,
      drafts: Object.fromEntries(
        Object.entries(drafts).filter(([, value]) => isEntry(value)) as [string, TConversationDraftEntry][]
      ),
    };
  } catch {
    return emptyStore();
  }
};

export const writeConversationDraftStore = (
  storageKey: string | null,
  store: TConversationDraftStore,
  storage: TStorage | null = getBrowserStorage()
) => {
  if (!storageKey || !storage) return;
  try {
    storage.setItem(storageKey, JSON.stringify(store));
  } catch {
    // Browser storage can be unavailable or full; the in-memory draft remains authoritative for this session.
  }
};

export const setConversationDraft = (
  store: TConversationDraftStore,
  targetKey: string,
  snapshot: TConversationDraftSnapshot,
  updatedAt = Date.now()
): TConversationDraftStore => {
  if (!snapshot.text) {
    if (!store.drafts[targetKey]) return store;
    const drafts = { ...store.drafts };
    delete drafts[targetKey];
    return { version: 1, drafts };
  }
  return {
    version: 1,
    drafts: {
      ...store.drafts,
      [targetKey]: { ...snapshot, updatedAt },
    },
  };
};

export const clearConversationDraftSnapshot = (
  store: TConversationDraftStore,
  targetKey: string,
  snapshot: TConversationDraftSnapshot
): TConversationDraftStore => {
  const current = store.drafts[targetKey];
  if (
    !current ||
    current.text !== snapshot.text ||
    current.context.channelId !== snapshot.context.channelId ||
    current.context.rootId !== snapshot.context.rootId ||
    current.context.parentId !== snapshot.context.parentId
  ) {
    return store;
  }
  const drafts = { ...store.drafts };
  delete drafts[targetKey];
  return { version: 1, drafts };
};
