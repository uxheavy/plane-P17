/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import type {
  IConversationAttachment,
  IConversationChannel,
  IConversationMessage,
  IConversationMessageInput,
  TConversationCreationOrigin,
} from "@plane/types";
import { useTranslation } from "@plane/i18n";
import { ConversationRequestError, conversationService } from "@plane/services";
import { conversationAttachmentService } from "@/services/conversation-attachment.service";
import {
  ConversationProposalUncertainError,
  readConversationProposal,
  requestConversationProposal,
  type TConversationProposalRequest,
  type TConversationProposalResponse,
  type TConversationProposalResult,
} from "@/services/conversation-proposal.service";
import { applySendError, applySentMessage, getErrorMessage, mergeMessages } from "./conversation-message-delivery";
import {
  buildConversationNavigationHref,
  CHAT_CHANNEL_QUERY_PARAM,
  CHAT_MESSAGE_QUERY_PARAM,
  CHAT_THREAD_QUERY_PARAM,
} from "./conversation-navigation";
import {
  clearConversationDraftSnapshot,
  getConversationDraftStorageKey,
  readConversationDraftStore,
  setConversationDraft,
  type TConversationDraftContext,
  type TConversationDraftStore,
  writeConversationDraftStore,
} from "./conversation-drafts";

export const getTargetKey = (channelId: string, rootId: string | null, parentId: string | null) =>
  `${channelId}:${rootId ?? "root"}:${parentId ?? "root"}`;

export const getMessageAncestorIds = (
  messages: IConversationMessage[],
  rootId: string,
  messageId: string
): Set<string> | null => {
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  if (!messagesById.has(messageId) || !messagesById.has(rootId)) return null;
  const ancestorIds = new Set<string>([rootId]);
  const visited = new Set<string>();
  let currentId = messageId;
  while (currentId !== rootId) {
    if (visited.has(currentId)) return null;
    visited.add(currentId);
    const message = messagesById.get(currentId);
    if (!message?.parent_id) return null;
    ancestorIds.add(message.parent_id);
    currentId = message.parent_id;
  }
  return ancestorIds;
};

export type TChatSidebarTab = "projects" | "chat";

export type TChatSendRetry = IConversationMessageInput & {
  channelId: string;
  rootId: string | null;
  targetKey: string;
  draftValue: string;
};

export type TConversationProposal = {
  requestId: string;
  origin: TConversationCreationOrigin;
  agentUserId: string | null;
  status: "selecting" | "submitting" | "processing" | "uncertain" | "completed" | "failed";
  result?: TConversationProposalResult;
  error?: string;
};

export type TChatAttachmentDraft = {
  id: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
  asset?: IConversationAttachment;
  error?: string;
};

export type TChatSidebarState = {
  activeTab: TChatSidebarTab;
  channels: IConversationChannel[];
  selectedChannelId: string | null;
  openThreadId: string | null;
  selectedMessageId: string | null;
  replyTargetId: string | null;
  rootsByChannel: Record<string, IConversationMessage[]>;
  threadMessagesByRoot: Record<string, IConversationMessage[]>;
  collapsedThreadBranches: Record<string, string[]>;
  rootNextCursors: Record<string, string | null | undefined>;
  threadNextCursors: Record<string, string | null | undefined>;
  drafts: Record<string, string>;
  attachmentDrafts: Record<string, TChatAttachmentDraft[]>;
  sendErrors: Record<string, string | undefined>;
  sendRetries: Record<string, TChatSendRetry | undefined>;
  loadingChannels: boolean;
  loadingRoots: Record<string, boolean | undefined>;
  loadingThreads: Record<string, boolean | undefined>;
  channelError: string | null;
  rootErrors: Record<string, string | undefined>;
  threadErrors: Record<string, string | undefined>;
  channelDraft: string;
  isChannelFormOpen: boolean;
  isCreatingChannel: boolean;
  conversationProposal: TConversationProposal | null;
  pendingSendTargets: Record<string, boolean | undefined>;
};

export type TChatSidebarActions = {
  selectChannel: (channelId: string) => void;
  openThread: (rootId: string) => void;
  closeThread: () => void;
  selectReplyTarget: (messageId: string) => void;
  clearReplyTarget: () => void;
  toggleThreadBranch: (rootId: string, messageId: string) => void;
  setActiveTab: (tab: TChatSidebarTab) => void;
  setDraft: (targetKey: string, value: string, context: TConversationDraftContext) => void;
  addAttachments: (targetKey: string, files: File[]) => void;
  removeAttachment: (targetKey: string, attachmentId: string) => Promise<void>;
  setChannelDraft: (value: string) => void;
  setChannelFormOpen: (isOpen: boolean) => void;
  createChannel: () => Promise<void>;
  beginConversationProposal: (origin: TConversationCreationOrigin) => void;
  submitConversationProposal: (agentUserId: string) => Promise<void>;
  clearConversationProposal: () => void;
  retryChannels: () => void;
  retryRoots: (channelId: string) => void;
  retryThread: (rootId: string) => void;
  loadMoreRoots: (channelId: string) => void;
  loadMoreThread: (rootId: string) => void;
  sendMessage: (targetKey: string, content: string, parentId: string | null) => Promise<void>;
  retrySend: (targetKey: string) => Promise<void>;
};

export const DEFAULT_CHAT_SIDEBAR_STATE: TChatSidebarState = {
  activeTab: "projects",
  channels: [],
  selectedChannelId: null,
  openThreadId: null,
  selectedMessageId: null,
  replyTargetId: null,
  rootsByChannel: {},
  threadMessagesByRoot: {},
  collapsedThreadBranches: {},
  rootNextCursors: {},
  threadNextCursors: {},
  drafts: {},
  attachmentDrafts: {},
  sendErrors: {},
  sendRetries: {},
  loadingChannels: false,
  loadingRoots: {},
  loadingThreads: {},
  channelError: null,
  rootErrors: {},
  threadErrors: {},
  channelDraft: "",
  isChannelFormOpen: false,
  isCreatingChannel: false,
  conversationProposal: null,
  pendingSendTargets: {},
};

export function useChatSidebarState(
  workspaceSlug: string,
  userId: string | null
): [TChatSidebarState, TChatSidebarActions] {
  const { t } = useTranslation();
  const translateRef = useRef(t);
  translateRef.current = t;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathnameRef = useRef(pathname);
  const searchParamsRef = useRef(searchParams);
  const selectedChannelIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(false);
  pathnameRef.current = pathname;
  searchParamsRef.current = searchParams;
  const routedChannelId = searchParams.get(CHAT_CHANNEL_QUERY_PARAM);
  const routedThreadId = searchParams.get(CHAT_THREAD_QUERY_PARAM);
  const routedMessageId = searchParams.get(CHAT_MESSAGE_QUERY_PARAM);
  const draftStorageKey = getConversationDraftStorageKey(workspaceSlug, userId);
  const draftStoreKeyRef = useRef<string | null>(null);
  const draftStoreRef = useRef<TConversationDraftStore | null>(null);
  const restoredDraftKeysRef = useRef(new Set<string>());
  const replyTargetIntentRef = useRef<{ scopeKey: string; targetId: string | null } | null>(null);
  if (draftStoreKeyRef.current !== draftStorageKey) {
    draftStoreKeyRef.current = draftStorageKey;
    draftStoreRef.current = readConversationDraftStore(draftStorageKey);
    restoredDraftKeysRef.current.clear();
    replyTargetIntentRef.current = null;
  }
  const [state, setState] = useState<TChatSidebarState>(() => ({
    ...DEFAULT_CHAT_SIDEBAR_STATE,
    activeTab: routedChannelId ? "chat" : "projects",
    selectedChannelId: routedChannelId,
    openThreadId: routedThreadId,
    selectedMessageId: routedMessageId,
    replyTargetId: routedThreadId,
  }));
  selectedChannelIdRef.current = state.selectedChannelId;

  const updateRoute = useCallback(
    (
      channelId: string | null,
      threadId: string | null,
      messageId: string | null,
      navigation: "push" | "replace" = "push"
    ) => {
      const currentQuery = searchParamsRef.current.toString();
      const currentHash = typeof window !== "undefined" ? window.location.hash : "";
      const currentHref = `${pathnameRef.current}${currentQuery ? `?${currentQuery}` : ""}${currentHash}`;
      const nextHref = buildConversationNavigationHref(currentHref, {
        channelId,
        threadId,
        messageId,
      });
      if (nextHref === currentHref) return;
      router[navigation](nextHref);
    },
    [router]
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (routedChannelId) {
      setState((current) =>
        current.selectedChannelId === routedChannelId &&
        current.openThreadId === routedThreadId &&
        current.selectedMessageId === routedMessageId
          ? current
          : {
              ...current,
              activeTab: "chat",
              selectedChannelId: routedChannelId,
              openThreadId: routedThreadId,
              selectedMessageId: routedMessageId,
              replyTargetId: routedThreadId,
            }
      );
    } else if (state.selectedChannelId) {
      // Work-surface links omit chat parameters; preserve the sidebar in the new URL.
      updateRoute(state.selectedChannelId, state.openThreadId, state.selectedMessageId, "replace");
    }
  }, [
    pathname,
    routedChannelId,
    routedMessageId,
    routedThreadId,
    state.openThreadId,
    state.selectedChannelId,
    state.selectedMessageId,
    updateRoute,
  ]);

  useEffect(() => {
    if (!draftStorageKey || !state.selectedChannelId) return;
    const channelId = state.selectedChannelId;
    const rootId = state.openThreadId;
    const scopeKey = `${draftStorageKey}:${channelId}:${rootId ?? "channel"}`;

    let accessibleMessages: IConversationMessage[] | null = null;
    if (rootId) {
      const threadMessages = state.threadMessagesByRoot[rootId];
      if (!threadMessages) return;
      const threadRoot =
        threadMessages.find((message) => message.id === rootId) ??
        state.rootsByChannel[channelId]?.find((message) => message.id === rootId);
      if (!threadRoot) return;
      accessibleMessages = [threadRoot, ...threadMessages];
    } else if (!state.rootsByChannel[channelId]) {
      return;
    }

    const scopedEntries = Object.entries(draftStoreRef.current?.drafts ?? {}).filter(
      ([, entry]) => entry.context.channelId === channelId && entry.context.rootId === rootId
    );
    const candidates = scopedEntries.filter(([, entry]) => {
      if (entry.context.channelId !== channelId || entry.context.rootId !== rootId) return false;
      if (!rootId) return entry.context.parentId === null;
      return (
        entry.context.parentId !== null &&
        accessibleMessages !== null &&
        getMessageAncestorIds(accessibleMessages, rootId, entry.context.parentId) !== null
      );
    });
    if (candidates.length === 0) return;

    const newestScopedEntry = scopedEntries.reduce<(typeof scopedEntries)[number] | null>(
      (latest, candidate) => (!latest || candidate[1].updatedAt > latest[1].updatedAt ? candidate : latest),
      null
    );
    const newestCandidate = newestScopedEntry
      ? candidates.find(([targetKey]) => targetKey === newestScopedEntry[0])
      : undefined;
    if (rootId && state.threadNextCursors[rootId] && !newestCandidate) return;

    const activeEntry = newestCandidate
      ? { targetKey: newestCandidate[0], entry: newestCandidate[1] }
      : candidates.reduce<{
          targetKey: string;
          entry: TConversationDraftStore["drafts"][string];
        } | null>((latest, candidate) => {
          const [targetKey, entry] = candidate;
          return !latest || entry.updatedAt > latest.entry.updatedAt ? { targetKey, entry } : latest;
        }, null);
    if (!activeEntry) return;
    setState((current) => {
      const currentTargetKey = getTargetKey(channelId, rootId, current.replyTargetId ?? rootId);
      const hasCurrentText =
        Boolean(current.drafts[currentTargetKey]?.trim()) && !restoredDraftKeysRef.current.has(currentTargetKey);
      const hasReplyTargetIntent = replyTargetIntentRef.current?.scopeKey === scopeKey;
      const drafts = { ...current.drafts };
      let changed = false;
      for (const [targetKey, entry] of candidates) {
        if (drafts[targetKey] === undefined) {
          drafts[targetKey] = entry.text;
          restoredDraftKeysRef.current.add(targetKey);
          changed = true;
        }
      }
      const nextReplyTargetId =
        rootId && !hasCurrentText && !hasReplyTargetIntent ? activeEntry.entry.context.parentId : current.replyTargetId;
      if (!changed && nextReplyTargetId === current.replyTargetId) return current;
      return {
        ...current,
        drafts,
        replyTargetId: nextReplyTargetId,
      };
    });
  }, [
    draftStorageKey,
    state.openThreadId,
    state.replyTargetId,
    state.rootsByChannel,
    state.selectedChannelId,
    state.threadNextCursors,
    state.threadMessagesByRoot,
  ]);

  const loadChannels = useCallback(async () => {
    setState((current) => ({ ...current, loadingChannels: true, channelError: null }));
    try {
      const channels = await conversationService.listChannels(workspaceSlug);
      setState((current) => {
        const selectedChannelId = current.selectedChannelId ?? channels[0]?.id ?? null;
        return {
          ...current,
          channels,
          selectedChannelId,
          loadingChannels: false,
        };
      });
    } catch (error) {
      const requestError = error instanceof ConversationRequestError ? error : ConversationRequestError.unknown();
      setState((current) => ({
        ...current,
        loadingChannels: false,
        channelError: getErrorMessage(
          requestError,
          translateRef.current("sidebar.chat.load_channels_error"),
          translateRef.current("sidebar.chat.unavailable")
        ),
      }));
    }
  }, [workspaceSlug]);

  const loadRoots = useCallback(async (channelId: string, cursor?: string) => {
    setState((current) => ({
      ...current,
      loadingRoots: { ...current.loadingRoots, [channelId]: true },
      rootErrors: { ...current.rootErrors, [channelId]: undefined },
    }));
    try {
      const page = await conversationService.listMessages(channelId, cursor);
      setState((current) => ({
        ...current,
        rootsByChannel: {
          ...current.rootsByChannel,
          [channelId]: mergeMessages(current.rootsByChannel[channelId] ?? [], page.results),
        },
        rootNextCursors: { ...current.rootNextCursors, [channelId]: page.next_cursor },
        loadingRoots: { ...current.loadingRoots, [channelId]: false },
      }));
    } catch (error) {
      const requestError = error instanceof ConversationRequestError ? error : ConversationRequestError.unknown();
      setState((current) => ({
        ...current,
        loadingRoots: { ...current.loadingRoots, [channelId]: false },
        rootErrors: {
          ...current.rootErrors,
          [channelId]: getErrorMessage(
            requestError,
            translateRef.current("sidebar.chat.load_messages_error"),
            translateRef.current("sidebar.chat.unavailable")
          ),
        },
      }));
    }
  }, []);

  const loadThread = useCallback(
    async (rootId: string, cursor?: string) => {
      const channelId = state.selectedChannelId;
      if (!channelId) return;
      setState((current) => ({
        ...current,
        loadingThreads: { ...current.loadingThreads, [rootId]: true },
        threadErrors: { ...current.threadErrors, [rootId]: undefined },
      }));
      try {
        const page = await conversationService.listThread(channelId, rootId, cursor);
        setState((current) => ({
          ...current,
          threadMessagesByRoot: {
            ...current.threadMessagesByRoot,
            [rootId]: mergeMessages(current.threadMessagesByRoot[rootId] ?? [], page.results),
          },
          threadNextCursors: { ...current.threadNextCursors, [rootId]: page.next_cursor },
          loadingThreads: { ...current.loadingThreads, [rootId]: false },
        }));
      } catch (error) {
        const requestError = error instanceof ConversationRequestError ? error : ConversationRequestError.unknown();
        setState((current) => ({
          ...current,
          loadingThreads: { ...current.loadingThreads, [rootId]: false },
          threadErrors: {
            ...current.threadErrors,
            [rootId]: getErrorMessage(
              requestError,
              translateRef.current("sidebar.chat.load_thread_error"),
              translateRef.current("sidebar.chat.unavailable")
            ),
          },
        }));
      }
    },
    [state.selectedChannelId]
  );

  useEffect(() => {
    if (state.activeTab === "chat") void loadChannels();
  }, [loadChannels, state.activeTab]);

  useEffect(() => {
    if (state.activeTab === "chat" && state.selectedChannelId) {
      if (
        !state.rootsByChannel[state.selectedChannelId] &&
        !state.loadingRoots[state.selectedChannelId] &&
        !state.rootErrors[state.selectedChannelId]
      ) {
        void loadRoots(state.selectedChannelId);
      }
    }
  }, [loadRoots, state.activeTab, state.loadingRoots, state.rootErrors, state.rootsByChannel, state.selectedChannelId]);

  useEffect(() => {
    if (state.activeTab === "chat" && state.openThreadId) {
      if (
        !state.threadMessagesByRoot[state.openThreadId] &&
        !state.loadingThreads[state.openThreadId] &&
        !state.threadErrors[state.openThreadId]
      ) {
        void loadThread(state.openThreadId);
      }
    }
  }, [
    loadThread,
    state.activeTab,
    state.loadingThreads,
    state.openThreadId,
    state.threadErrors,
    state.threadMessagesByRoot,
  ]);

  useEffect(() => {
    if (!state.selectedChannelId || state.openThreadId || !state.selectedMessageId) return;
    const channelId = state.selectedChannelId;
    const roots = state.rootsByChannel[channelId] ?? [];
    if (roots.some((message) => message.id === state.selectedMessageId)) return;
    const cursor = state.rootNextCursors[channelId];
    if (!cursor || state.loadingRoots[channelId] || state.rootErrors[channelId]) return;
    void loadRoots(channelId, cursor);
  }, [
    loadRoots,
    state.loadingRoots,
    state.openThreadId,
    state.rootErrors,
    state.rootNextCursors,
    state.rootsByChannel,
    state.selectedChannelId,
    state.selectedMessageId,
  ]);

  useEffect(() => {
    if (!state.selectedChannelId || !state.openThreadId || !state.selectedMessageId) return;
    const loadedMessages = state.threadMessagesByRoot[state.openThreadId] ?? [];
    const root = state.rootsByChannel[state.selectedChannelId]?.find((message) => message.id === state.openThreadId);
    const messages = root ? [root, ...loadedMessages] : loadedMessages;
    if (getMessageAncestorIds(messages, state.openThreadId, state.selectedMessageId)) return;
    const cursor = state.threadNextCursors[state.openThreadId];
    if (!cursor || state.loadingThreads[state.openThreadId] || state.threadErrors[state.openThreadId]) return;
    void loadThread(state.openThreadId, cursor);
  }, [
    loadThread,
    state.loadingThreads,
    state.openThreadId,
    state.rootsByChannel,
    state.selectedChannelId,
    state.selectedMessageId,
    state.threadErrors,
    state.threadMessagesByRoot,
    state.threadNextCursors,
  ]);

  const selectChannel = useCallback(
    (channelId: string) => {
      replyTargetIntentRef.current = null;
      setState((current) => ({ ...current, activeTab: "chat" }));
      updateRoute(channelId, null, null);
    },
    [updateRoute]
  );

  const openThread = useCallback(
    (rootId: string) => {
      replyTargetIntentRef.current = null;
      setState((current) => ({
        ...current,
        activeTab: "chat",
        openThreadId: rootId,
        selectedMessageId: null,
        replyTargetId: rootId,
      }));
      updateRoute(selectedChannelIdRef.current, rootId, null);
    },
    [updateRoute]
  );

  const closeThread = useCallback(() => {
    replyTargetIntentRef.current = null;
    updateRoute(state.selectedChannelId, null, null);
  }, [state.selectedChannelId, updateRoute]);

  const setActiveTab = useCallback((activeTab: TChatSidebarTab) => {
    setState((current) => ({ ...current, activeTab }));
  }, []);

  const selectReplyTarget = useCallback(
    (messageId: string) => {
      replyTargetIntentRef.current = {
        scopeKey: `${draftStorageKey ?? ""}:${state.selectedChannelId ?? ""}:${state.openThreadId ?? "channel"}`,
        targetId: messageId,
      };
      setState((current) => ({ ...current, replyTargetId: messageId }));
    },
    [draftStorageKey, state.openThreadId, state.selectedChannelId]
  );

  const clearReplyTarget = useCallback(() => {
    replyTargetIntentRef.current = {
      scopeKey: `${draftStorageKey ?? ""}:${state.selectedChannelId ?? ""}:${state.openThreadId ?? "channel"}`,
      targetId: null,
    };
    setState((current) => ({ ...current, replyTargetId: null }));
  }, [draftStorageKey, state.openThreadId, state.selectedChannelId]);

  const toggleThreadBranch = useCallback((rootId: string, messageId: string) => {
    setState((current) => {
      const collapsed = current.collapsedThreadBranches[rootId] ?? [];
      const nextCollapsed = collapsed.includes(messageId)
        ? collapsed.filter((collapsedId) => collapsedId !== messageId)
        : [...collapsed, messageId];
      return {
        ...current,
        collapsedThreadBranches: {
          ...current.collapsedThreadBranches,
          [rootId]: nextCollapsed,
        },
      };
    });
  }, []);

  const setDraft = useCallback(
    (targetKey: string, value: string, context: TConversationDraftContext) => {
      restoredDraftKeysRef.current.delete(targetKey);
      setState((current) => ({ ...current, drafts: { ...current.drafts, [targetKey]: value } }));
      if (!draftStorageKey || !context.channelId) return;
      const nextStore = setConversationDraft(draftStoreRef.current ?? { version: 1, drafts: {} }, targetKey, {
        text: value,
        context,
      });
      draftStoreRef.current = nextStore;
      writeConversationDraftStore(draftStorageKey, nextStore);
    },
    [draftStorageKey]
  );

  const addAttachments = useCallback(
    (targetKey: string, files: File[]) => {
      const channelId = state.selectedChannelId;
      if (!channelId || files.length === 0) return;
      const drafts = files.map<TChatAttachmentDraft>((file) => ({
        id: uuidv4(),
        name: file.name,
        size: file.size,
        status: "uploading",
      }));
      setState((current) => ({
        ...current,
        attachmentDrafts: {
          ...current.attachmentDrafts,
          [targetKey]: [...(current.attachmentDrafts[targetKey] ?? []), ...drafts],
        },
      }));
      for (const [index, file] of files.entries()) {
        const draft = drafts[index];
        void conversationAttachmentService
          .upload(channelId, file)
          .then((asset) => {
            setState((current) => {
              const targetDrafts = current.attachmentDrafts[targetKey] ?? [];
              if (!targetDrafts.some((candidate) => candidate.id === draft.id)) return current;
              return {
                ...current,
                attachmentDrafts: {
                  ...current.attachmentDrafts,
                  // oxlint-disable-next-line oxc/no-map-spread -- preserve immutable state updates
                  [targetKey]: targetDrafts.map((candidate) =>
                    candidate.id === draft.id ? { ...candidate, status: "ready", asset, error: undefined } : candidate
                  ),
                },
              };
            });
            return undefined;
          })
          .catch(() => {
            setState((current) => ({
              ...current,
              attachmentDrafts: {
                ...current.attachmentDrafts,
                // oxlint-disable-next-line oxc/no-map-spread -- preserve immutable state updates
                [targetKey]: (current.attachmentDrafts[targetKey] ?? []).map((candidate) =>
                  candidate.id === draft.id
                    ? { ...candidate, status: "error", error: "attachment_upload_error" }
                    : candidate
                ),
              },
            }));
          });
      }
    },
    [state.selectedChannelId]
  );

  const removeAttachment = useCallback(
    async (targetKey: string, attachmentId: string) => {
      const channelId = state.selectedChannelId;
      const draft = state.attachmentDrafts[targetKey]?.find((candidate) => candidate.id === attachmentId);
      if (!draft || !channelId) return;
      try {
        if (draft.asset) await conversationAttachmentService.delete(channelId, draft.asset.asset_id);
        setState((current) => ({
          ...current,
          attachmentDrafts: {
            ...current.attachmentDrafts,
            [targetKey]: (current.attachmentDrafts[targetKey] ?? []).filter(
              (candidate) => candidate.id !== attachmentId
            ),
          },
        }));
      } catch {
        setState((current) => ({
          ...current,
          attachmentDrafts: {
            ...current.attachmentDrafts,
            // oxlint-disable-next-line oxc/no-map-spread -- preserve immutable state updates
            [targetKey]: (current.attachmentDrafts[targetKey] ?? []).map((candidate) =>
              candidate.id === attachmentId
                ? { ...candidate, status: "error", error: "attachment_remove_error" }
                : candidate
            ),
          },
        }));
      }
    },
    [state.attachmentDrafts, state.selectedChannelId]
  );

  const setChannelDraft = useCallback((channelDraft: string) => {
    setState((current) => ({ ...current, channelDraft }));
  }, []);

  const setChannelFormOpen = useCallback((isChannelFormOpen: boolean) => {
    setState((current) => ({
      ...current,
      isChannelFormOpen,
      channelDraft: isChannelFormOpen ? current.channelDraft : "",
    }));
  }, []);

  const loadMoreRoots = useCallback(
    (channelId: string) => {
      const cursor = state.rootNextCursors[channelId];
      if (cursor) void loadRoots(channelId, cursor);
    },
    [loadRoots, state.rootNextCursors]
  );

  const loadMoreThread = useCallback(
    (rootId: string) => {
      const cursor = state.threadNextCursors[rootId];
      if (cursor) void loadThread(rootId, cursor);
    },
    [loadThread, state.threadNextCursors]
  );

  const createChannel = useCallback(async () => {
    const name = state.channelDraft.trim();
    if (!name || state.isCreatingChannel) return;
    setState((current) => ({ ...current, isCreatingChannel: true, channelError: null }));
    try {
      const channel = await conversationService.createChannel(workspaceSlug, name);
      if (!isMountedRef.current) return;
      setState((current) => ({
        ...current,
        channels: [...current.channels, channel],
        channelDraft: "",
        isChannelFormOpen: false,
        isCreatingChannel: false,
        activeTab: "chat",
      }));
      updateRoute(channel.id, null, null);
    } catch (error) {
      const requestError = error instanceof ConversationRequestError ? error : ConversationRequestError.unknown();
      setState((current) => ({
        ...current,
        isCreatingChannel: false,
        channelError: getErrorMessage(
          requestError,
          translateRef.current("sidebar.chat.create_channel_error"),
          translateRef.current("sidebar.chat.unavailable")
        ),
      }));
    }
  }, [state.channelDraft, state.isCreatingChannel, updateRoute, workspaceSlug]);

  const beginConversationProposal = useCallback((origin: TConversationCreationOrigin) => {
    setState((current) => {
      if (current.conversationProposal && current.conversationProposal.status !== "failed") return current;
      return {
        ...current,
        conversationProposal: {
          requestId: uuidv4(),
          origin,
          agentUserId: null,
          status: "selecting",
        },
      };
    });
  }, []);

  const submitConversationProposal = useCallback(
    async (agentUserId: string) => {
      const proposal = state.conversationProposal;
      if (!proposal || proposal.status !== "selecting") return;

      setState((current) =>
        current.conversationProposal?.requestId === proposal.requestId
          ? {
              ...current,
              conversationProposal: { ...proposal, agentUserId, status: "submitting", error: undefined },
            }
          : current
      );

      try {
        const response = await requestConversationProposal(proposal.origin.channel_id, {
          request_id: proposal.requestId,
          agent_user_id: agentUserId,
          thread_id: proposal.origin.thread_root_id,
        });
        setState((current) =>
          current.conversationProposal?.requestId === proposal.requestId
            ? {
                ...current,
                conversationProposal: {
                  ...current.conversationProposal,
                  agentUserId,
                  status:
                    response.status === "completed"
                      ? "completed"
                      : response.status === "failed"
                        ? "failed"
                        : "processing",
                  result: response.status === "completed" ? response.result : undefined,
                  error: response.status === "failed" ? translateRef.current("sidebar.chat.proposal_error") : undefined,
                },
              }
            : current
        );
      } catch (error) {
        const isUncertain = error instanceof ConversationProposalUncertainError;
        setState((current) =>
          current.conversationProposal?.requestId === proposal.requestId
            ? {
                ...current,
                conversationProposal: {
                  ...current.conversationProposal,
                  agentUserId,
                  status: isUncertain ? "uncertain" : "failed",
                  error: isUncertain ? undefined : translateRef.current("sidebar.chat.proposal_error"),
                },
              }
            : current
        );
      }
    },
    [state.conversationProposal]
  );

  const clearConversationProposal = useCallback(() => {
    setState((current) => ({ ...current, conversationProposal: null }));
  }, []);

  useEffect(() => {
    const proposal = state.conversationProposal;
    if (!proposal || !["processing", "uncertain"].includes(proposal.status) || !proposal.agentUserId) return;

    let isCancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const request: TConversationProposalRequest = {
      request_id: proposal.requestId,
      agent_user_id: proposal.agentUserId,
      thread_id: proposal.origin.thread_root_id,
    };

    const applyResponse = (response: TConversationProposalResponse) => {
      if (isCancelled) return;
      setState((current) => {
        if (current.conversationProposal?.requestId !== proposal.requestId) return current;
        if (response.status === "completed") {
          return {
            ...current,
            conversationProposal: {
              ...current.conversationProposal,
              status: "completed",
              result: response.result,
              error: undefined,
            },
          };
        }
        if (response.status === "failed") {
          return {
            ...current,
            conversationProposal: {
              ...current.conversationProposal,
              status: "failed",
              error: translateRef.current("sidebar.chat.proposal_error"),
            },
          };
        }
        return current;
      });
    };

    const scheduleRetry = (callback: () => void, delay: number) => {
      if (!isCancelled) retryTimer = setTimeout(callback, delay);
    };

    const poll = async () => {
      if (isCancelled) return;
      try {
        const response = await readConversationProposal(proposal.origin.channel_id, request);
        if (isCancelled) return;
        if (response.status === "accepted" || response.status === "processing") {
          scheduleRetry(poll, 500);
        } else {
          applyResponse(response);
        }
      } catch {
        if (isCancelled) return;
        // A read error after submission is ambiguous too. Keep the same UUID
        // pending so a delayed POST cannot be followed by a duplicate job.
        setState((current) =>
          current.conversationProposal?.requestId === proposal.requestId &&
          (current.conversationProposal.status === "processing" || current.conversationProposal.status === "uncertain")
            ? {
                ...current,
                conversationProposal: { ...current.conversationProposal, status: "uncertain", error: undefined },
              }
            : current
        );
        scheduleRetry(poll, 1000);
      }
    };

    retryTimer = setTimeout(poll, 500);
    return () => {
      isCancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- primitive proposal fields identify the request snapshot.
  }, [
    state.conversationProposal?.agentUserId,
    state.conversationProposal?.origin.channel_id,
    state.conversationProposal?.origin.thread_root_id,
    state.conversationProposal?.requestId,
    state.conversationProposal?.status,
  ]);

  const executeSend = useCallback(
    async (retry: TChatSendRetry) => {
      setState((current) => ({
        ...current,
        pendingSendTargets: { ...current.pendingSendTargets, [retry.targetKey]: true },
        sendErrors: { ...current.sendErrors, [retry.targetKey]: undefined },
        sendRetries: { ...current.sendRetries, [retry.targetKey]: undefined },
      }));
      try {
        const message = await conversationService.sendMessage(retry.channelId, {
          content: retry.content,
          parent_id: retry.parent_id,
          client_id: retry.client_id,
          attachment_ids: retry.attachment_ids,
        });
        if (draftStorageKey) {
          const snapshot = {
            text: retry.draftValue,
            context: {
              channelId: retry.channelId,
              rootId: retry.rootId,
              parentId: retry.parent_id,
            },
          };
          const currentStore = draftStoreRef.current ?? { version: 1, drafts: {} };
          const nextInMemoryStore = clearConversationDraftSnapshot(currentStore, retry.targetKey, snapshot);
          const nextPersistedStore = clearConversationDraftSnapshot(
            readConversationDraftStore(draftStorageKey),
            retry.targetKey,
            snapshot
          );
          draftStoreRef.current = nextInMemoryStore;
          writeConversationDraftStore(draftStorageKey, nextPersistedStore);
        }
        setState((current) => applySentMessage(current, retry, message));
      } catch (error) {
        const requestError = error instanceof ConversationRequestError ? error : ConversationRequestError.unknown();
        setState((current) =>
          applySendError(
            current,
            retry.targetKey,
            requestError,
            retry,
            getErrorMessage(
              requestError,
              translateRef.current("sidebar.chat.send_error"),
              translateRef.current("sidebar.chat.unavailable")
            )
          )
        );
      }
    },
    [draftStorageKey]
  );

  const sendMessage = useCallback(
    async (targetKey: string, draftValue: string, parentId: string | null) => {
      const channelId = state.selectedChannelId;
      const content = draftValue.trim();
      const attachmentIds = (state.attachmentDrafts[targetKey] ?? [])
        .filter((draft) => draft.status === "ready" && draft.asset)
        .map((draft) => draft.asset?.asset_id)
        .filter((assetId): assetId is string => Boolean(assetId));
      const hasUploadingAttachments = (state.attachmentDrafts[targetKey] ?? []).some(
        (draft) => draft.status === "uploading"
      );
      const hasFailedAttachments = (state.attachmentDrafts[targetKey] ?? []).some((draft) => draft.status === "error");
      if (
        !channelId ||
        (!content && attachmentIds.length === 0) ||
        hasUploadingAttachments ||
        hasFailedAttachments ||
        state.pendingSendTargets[targetKey]
      ) {
        return;
      }
      const retry = {
        content,
        parent_id: parentId,
        client_id: uuidv4(),
        attachment_ids: attachmentIds,
        channelId,
        rootId: state.openThreadId,
        targetKey,
        draftValue,
      };
      await executeSend(retry);
    },
    [executeSend, state.attachmentDrafts, state.openThreadId, state.pendingSendTargets, state.selectedChannelId]
  );

  const retrySend = useCallback(
    async (targetKey: string) => {
      const retry = state.sendRetries[targetKey];
      if (!retry || state.pendingSendTargets[targetKey]) return;
      await executeSend(retry);
    },
    [executeSend, state.pendingSendTargets, state.sendRetries]
  );

  const retryChannels = useCallback(() => void loadChannels(), [loadChannels]);
  const retryRoots = useCallback((channelId: string) => void loadRoots(channelId), [loadRoots]);
  const retryThread = useCallback((rootId: string) => void loadThread(rootId), [loadThread]);

  return [
    state,
    {
      closeThread,
      clearReplyTarget,
      clearConversationProposal,
      createChannel,
      beginConversationProposal,
      addAttachments,
      loadMoreRoots,
      loadMoreThread,
      openThread,
      retryChannels,
      retryRoots,
      retrySend,
      retryThread,
      selectChannel,
      selectReplyTarget,
      submitConversationProposal,
      toggleThreadBranch,
      removeAttachment,
      sendMessage,
      setActiveTab,
      setChannelDraft,
      setChannelFormOpen,
      setDraft,
    },
  ];
}
