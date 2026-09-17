/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ArrowLeft, Hash, LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { IconButton } from "@plane/propel/icon-button";
import type { IConversationMessage, TConversationCreationOrigin } from "@plane/types";
import { ConversationError } from "./conversation-feedback";
import { MessageComposer } from "./conversation-composer";
import { MessageCard } from "./conversation-message";
import {
  getMessageAncestorIds,
  getTargetKey,
  type TChatSidebarActions,
  type TChatSidebarState,
} from "./conversation-sidebar-state";

type TCreateWorkItem = (origin: TConversationCreationOrigin) => void;

function ThreadHeader({ channelName, onBack }: { channelName: string | undefined; onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 border-b border-subtle px-1 pb-2">
      <IconButton
        aria-label={t("sidebar.chat.back_to_channel")}
        icon={ArrowLeft}
        onClick={onBack}
        size="sm"
        variant="ghost"
      />
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-12 font-medium text-primary">
          <Hash className="size-3.5 text-tertiary" />
          <span className="truncate">{channelName}</span>
        </div>
        <span className="text-10 text-tertiary">{t("sidebar.chat.thread")}</span>
      </div>
    </div>
  );
}

const orderMessagesChronologically = (messages: IConversationMessage[]) => {
  // The web TypeScript target does not include ES2023's toSorted yet.
  // eslint-disable-next-line unicorn/no-array-sort
  messages.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return messages;
};

function useSelectedMessageScroll({
  containerRef,
  scrollKey,
  selectedMessageId,
  isReady,
}: {
  containerRef: { current: HTMLElement | null };
  scrollKey: string | null;
  selectedMessageId: string | null;
  isReady: boolean;
}) {
  const selectedMessageScrollRef = useRef<string | null>(null);

  useEffect(() => {
    if (!scrollKey || !selectedMessageId) {
      selectedMessageScrollRef.current = null;
      return;
    }
    if (selectedMessageScrollRef.current === scrollKey || !isReady) return;

    const element = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>("[data-chat-message-id]") ?? []
    ).find((candidate) => candidate.dataset.chatMessageId === selectedMessageId);
    if (!element) return;
    element.scrollIntoView?.({ block: "center" });
    selectedMessageScrollRef.current = scrollKey;
  }, [containerRef, isReady, scrollKey, selectedMessageId]);
}

export function RootMessages({
  state,
  actions,
  onCreateWorkItem,
}: {
  state: TChatSidebarState;
  actions: TChatSidebarActions;
  onCreateWorkItem?: TCreateWorkItem;
}) {
  const { t } = useTranslation();
  const channelId = state.selectedChannelId;
  const messageListRef = useRef<HTMLDivElement>(null);
  const roots = channelId ? (state.rootsByChannel[channelId] ?? []) : [];
  const isLoading = channelId ? Boolean(state.loadingRoots[channelId]) : false;
  const error = channelId ? state.rootErrors[channelId] : undefined;
  const targetKey = channelId ? getTargetKey(channelId, null, null) : "";
  const nextCursor = channelId ? state.rootNextCursors[channelId] : null;
  const selectedMessageReady =
    !state.selectedMessageId || roots.some((message) => message.id === state.selectedMessageId);
  const selectedMessageUnavailable =
    Boolean(state.selectedMessageId) && !selectedMessageReady && !isLoading && !error && !nextCursor;

  useSelectedMessageScroll({
    containerRef: messageListRef,
    isReady: selectedMessageReady,
    scrollKey: channelId && state.selectedMessageId ? `${channelId}:${state.selectedMessageId}` : null,
    selectedMessageId: state.selectedMessageId,
  });

  if (!channelId) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-12 text-tertiary">
        {t("sidebar.chat.select_channel")}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 pt-3">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1" ref={messageListRef}>
        {error ? (
          <ConversationError message={error} onRetry={() => actions.retryRoots(channelId)} />
        ) : isLoading && roots.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-12 text-tertiary">
            <LoaderCircle className="size-3.5 animate-spin" />
            {t("sidebar.chat.loading")}
          </div>
        ) : roots.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-12 text-tertiary">
            <span>{selectedMessageUnavailable ? t("sidebar.chat.unavailable") : t("sidebar.chat.no_messages")}</span>
          </div>
        ) : (
          <>
            {roots.map((message) => (
              <MessageCard
                key={message.id}
                isRoot
                isSelected={state.selectedMessageId === message.id}
                message={message}
                onOpenThread={message.reply_count > 0 ? () => actions.openThread(message.id) : undefined}
                onReply={() => actions.openThread(message.id)}
                replyCount={message.reply_count}
              />
            ))}
            {selectedMessageUnavailable ? (
              <p className="py-4 text-center text-12 text-tertiary">{t("sidebar.chat.unavailable")}</p>
            ) : null}
          </>
        )}
        {nextCursor && (
          <Button
            disabled={isLoading}
            loading={isLoading}
            onClick={() => actions.loadMoreRoots(channelId)}
            size="sm"
            variant="ghost"
          >
            {t("sidebar.chat.load_more")}
          </Button>
        )}
      </div>
      <MessageComposer
        actions={actions}
        onCreateWorkItem={
          onCreateWorkItem
            ? () => onCreateWorkItem({ kind: "conversation", channel_id: channelId, thread_root_id: null })
            : undefined
        }
        parentId={null}
        placeholder={t("sidebar.chat.message_placeholder")}
        state={state}
        targetKey={targetKey}
      />
    </div>
  );
}

export function ThreadPanel({
  state,
  actions,
  onCreateWorkItem,
}: {
  state: TChatSidebarState;
  actions: TChatSidebarActions;
  onCreateWorkItem?: TCreateWorkItem;
}) {
  const { t } = useTranslation();
  const channelId = state.selectedChannelId;
  const rootId = state.openThreadId;
  const selectedMessageScrollKey = rootId && state.selectedMessageId ? `${rootId}:${state.selectedMessageId}` : null;
  const messageListRef = useRef<HTMLDivElement>(null);
  const loadedMessages = rootId ? (state.threadMessagesByRoot[rootId] ?? []) : [];
  const root =
    channelId && rootId ? state.rootsByChannel[channelId]?.find((message) => message.id === rootId) : undefined;
  const threadRoot = rootId ? (loadedMessages.find((message) => message.id === rootId) ?? root) : undefined;
  const selectedMessageAncestors =
    state.selectedMessageId && rootId && threadRoot
      ? getMessageAncestorIds([threadRoot, ...loadedMessages], rootId, state.selectedMessageId)
      : null;
  const selectedMessageReady = !state.selectedMessageId || Boolean(selectedMessageAncestors);

  useSelectedMessageScroll({
    containerRef: messageListRef,
    isReady: selectedMessageReady,
    scrollKey: selectedMessageScrollKey,
    selectedMessageId: state.selectedMessageId,
  });

  if (!channelId || !rootId) return null;

  const error = state.threadErrors[rootId];
  const isLoading = state.loadingThreads[rootId];
  const channelName = state.channels.find((channel) => channel.id === channelId)?.name;

  if (!threadRoot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 pt-1">
        <ThreadHeader channelName={channelName} onBack={actions.closeThread} />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-2 text-center text-12 text-tertiary">
          {error ? (
            <ConversationError message={error} onRetry={() => actions.retryThread(rootId)} />
          ) : isLoading ? (
            <>
              <LoaderCircle className="size-3.5 animate-spin" />
              {t("sidebar.chat.loading")}
            </>
          ) : state.selectedMessageId ? (
            t("sidebar.chat.unavailable")
          ) : (
            t("sidebar.chat.no_messages")
          )}
        </div>
      </div>
    );
  }

  const explicitReplyTarget = state.replyTargetId
    ? (loadedMessages.find((message) => message.id === state.replyTargetId) ??
      (state.replyTargetId === threadRoot.id ? threadRoot : undefined))
    : undefined;
  const replyTarget = explicitReplyTarget ?? threadRoot;
  const targetKey = getTargetKey(channelId, rootId, state.replyTargetId ?? rootId);
  const descendants = loadedMessages.filter((message) => message.id !== rootId);
  const parentById = new Map([threadRoot, ...loadedMessages].map((message) => [message.id, message.parent_id]));
  const collapsedBranchIds = new Set(
    (state.collapsedThreadBranches[rootId] ?? []).filter((branchId) => !selectedMessageAncestors?.has(branchId))
  );
  const childrenByParentId = new Map<string, IConversationMessage[]>();
  const orphanedDescendants: IConversationMessage[] = [];
  const loadedMessageIds = new Set(parentById.keys());

  for (const message of descendants) {
    if (!message.parent_id || !loadedMessageIds.has(message.parent_id)) {
      orphanedDescendants.push(message);
      continue;
    }
    const children = childrenByParentId.get(message.parent_id) ?? [];
    children.push(message);
    childrenByParentId.set(message.parent_id, children);
  }

  for (const children of childrenByParentId.values()) orderMessagesChronologically(children);
  orderMessagesChronologically(orphanedDescendants);

  const orderedDescendants: IConversationMessage[] = [];
  const visitedMessageIds = new Set<string>();
  const appendExpandedReplies = (parentId: string) => {
    for (const message of childrenByParentId.get(parentId) ?? []) {
      if (visitedMessageIds.has(message.id)) continue;
      visitedMessageIds.add(message.id);
      orderedDescendants.push(message);
      appendExpandedReplies(message.id);
    }
  };

  appendExpandedReplies(rootId);
  for (const message of orphanedDescendants) {
    if (visitedMessageIds.has(message.id)) continue;
    visitedMessageIds.add(message.id);
    orderedDescendants.push(message);
    appendExpandedReplies(message.id);
  }

  const isDescendantOf = (messageId: string, ancestorId: string) => {
    let parentId = parentById.get(messageId) ?? null;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      if (parentId === ancestorId) return true;
      seen.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
    return false;
  };
  const visibleDescendants = orderedDescendants.filter(
    (message) => ![...collapsedBranchIds].some((branchId) => isDescendantOf(message.id, branchId))
  );
  const nextCursor = state.threadNextCursors[rootId];
  const selectedMessageUnavailable =
    Boolean(state.selectedMessageId) && !selectedMessageReady && !isLoading && !error && !nextCursor;

  const getDepth = (message: IConversationMessage) => {
    let depth = 1;
    let parentId = message.parent_id;
    const seen = new Set<string>();
    while (parentId && parentId !== rootId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = loadedMessages.find((candidate) => candidate.id === parentId);
      if (!parent) break;
      depth += 1;
      parentId = parent.parent_id;
    }
    return depth;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 pt-1">
      <ThreadHeader channelName={channelName} onBack={actions.closeThread} />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1" ref={messageListRef}>
        <MessageCard
          isRoot
          message={threadRoot}
          isSelected={selectedMessageReady && state.selectedMessageId === threadRoot.id}
          isReplyTarget={state.replyTargetId === rootId}
          branchReplyCount={threadRoot.reply_count}
          isBranchExpanded={!collapsedBranchIds.has(rootId)}
          onReply={() => actions.selectReplyTarget(rootId)}
          onToggleBranch={threadRoot.reply_count > 0 ? () => actions.toggleThreadBranch(rootId, rootId) : undefined}
        />
        {error ? (
          <ConversationError message={error} onRetry={() => actions.retryThread(rootId)} />
        ) : selectedMessageUnavailable ? (
          <p className="py-4 text-center text-12 text-tertiary">{t("sidebar.chat.unavailable")}</p>
        ) : isLoading && loadedMessages.length <= 1 ? (
          <div className="flex items-center justify-center gap-2 py-6 text-12 text-tertiary">
            <LoaderCircle className="size-3.5 animate-spin" />
            {t("sidebar.chat.loading")}
          </div>
        ) : descendants.length === 0 ? (
          <p className="py-4 text-center text-12 text-tertiary">{t("sidebar.chat.no_replies")}</p>
        ) : visibleDescendants.length === 0 ? null : (
          visibleDescendants.map((message) => {
            const branchReplyCount = message.reply_count;
            return (
              <MessageCard
                key={message.id}
                depth={getDepth(message)}
                branchReplyCount={branchReplyCount}
                isBranchExpanded={!collapsedBranchIds.has(message.id)}
                isSelected={selectedMessageReady && state.selectedMessageId === message.id}
                isReplyTarget={state.replyTargetId === message.id}
                message={message}
                onReply={() => actions.selectReplyTarget(message.id)}
                onToggleBranch={branchReplyCount > 0 ? () => actions.toggleThreadBranch(rootId, message.id) : undefined}
              />
            );
          })
        )}
        {nextCursor && (
          <Button
            disabled={isLoading}
            loading={isLoading}
            onClick={() => actions.loadMoreThread(rootId)}
            size="sm"
            variant="ghost"
          >
            {t("sidebar.chat.load_more")}
          </Button>
        )}
      </div>
      <MessageComposer
        actions={actions}
        parentId={state.replyTargetId ?? rootId}
        placeholder={t("sidebar.chat.reply_placeholder")}
        onClearReplyTarget={explicitReplyTarget ? () => actions.clearReplyTarget() : undefined}
        onCreateWorkItem={() =>
          onCreateWorkItem?.({ kind: "conversation", channel_id: channelId, thread_root_id: rootId })
        }
        replyTarget={replyTarget}
        state={state}
        targetKey={targetKey}
      />
    </div>
  );
}
