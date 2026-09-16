/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IConversationMessage } from "@plane/types";
import type { ConversationRequestError } from "@plane/services";
import type { TChatSendRetry, TChatSidebarState } from "./conversation-sidebar-state";

export const getErrorMessage = (error: ConversationRequestError, fallback: string, unavailable: string) => {
  if (error.status === 403 || error.status === 404) return unavailable;
  return fallback;
};

export const canRetrySend = (error: ConversationRequestError) => {
  return !(error.status === 401 || error.status === 403 || error.status === 404 || error.status === 409);
};

export const mergeMessages = (current: IConversationMessage[], incoming: IConversationMessage[]) => {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  // The web TypeScript target does not include ES2023's toSorted yet.
  // eslint-disable-next-line unicorn/no-array-sort
  return [...messages.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
};

export const applySentMessage = (
  current: TChatSidebarState,
  retry: TChatSendRetry,
  message: IConversationMessage
): TChatSidebarState => {
  const isRoot = retry.parent_id === null;
  const rootId = retry.rootId ?? message.root_id ?? message.id;
  const currentThreadMessages = current.threadMessagesByRoot[rootId] ?? [];
  const isNewReply = !isRoot && !currentThreadMessages.some((currentMessage) => currentMessage.id === message.id);
  const currentAttachmentDrafts = current.attachmentDrafts[retry.targetKey] ?? [];
  const sentAttachmentIds = new Set(retry.attachment_ids);
  const remainingAttachmentDrafts = currentAttachmentDrafts.filter(
    (draft) => !draft.asset || !sentAttachmentIds.has(draft.asset.asset_id)
  );
  return {
    ...current,
    rootsByChannel: isRoot
      ? {
          ...current.rootsByChannel,
          [retry.channelId]: mergeMessages(current.rootsByChannel[retry.channelId] ?? [], [message]),
        }
      : isNewReply
        ? {
            ...current.rootsByChannel,
            // oxlint-disable-next-line oxc/no-map-spread -- preserve immutable state updates
            [retry.channelId]: (current.rootsByChannel[retry.channelId] ?? []).map((root) =>
              root.id === rootId ? { ...root, reply_count: Number(root.reply_count ?? 0) + 1 } : root
            ),
          }
        : current.rootsByChannel,
    threadMessagesByRoot: isRoot
      ? current.threadMessagesByRoot
      : {
          ...current.threadMessagesByRoot,
          [rootId]: mergeMessages(current.threadMessagesByRoot[rootId] ?? [], [message]),
        },
    drafts:
      current.drafts[retry.targetKey] === retry.draftValue
        ? { ...current.drafts, [retry.targetKey]: "" }
        : current.drafts,
    attachmentDrafts:
      remainingAttachmentDrafts.length === currentAttachmentDrafts.length
        ? current.attachmentDrafts
        : { ...current.attachmentDrafts, [retry.targetKey]: remainingAttachmentDrafts },
    pendingSendTargets: { ...current.pendingSendTargets, [retry.targetKey]: undefined },
    sendErrors: { ...current.sendErrors, [retry.targetKey]: undefined },
    sendRetries: { ...current.sendRetries, [retry.targetKey]: undefined },
  };
};

export const applySendError = (
  current: TChatSidebarState,
  targetKey: string,
  error: ConversationRequestError,
  retry: TChatSendRetry,
  message: string
): TChatSidebarState => ({
  ...current,
  pendingSendTargets: { ...current.pendingSendTargets, [targetKey]: undefined },
  sendErrors: { ...current.sendErrors, [targetKey]: message },
  sendRetries: { ...current.sendRetries, [targetKey]: canRetrySend(error) ? retry : undefined },
});
