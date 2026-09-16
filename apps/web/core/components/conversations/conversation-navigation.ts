/**
 * Copyright (c) 2026-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const CHAT_CHANNEL_QUERY_PARAM = "chat_channel";
export const CHAT_THREAD_QUERY_PARAM = "chat_thread";
export const CHAT_MESSAGE_QUERY_PARAM = "chat_message";

export type TConversationNavigationTarget = {
  channelId: string | null;
  threadId: string | null;
  messageId: string | null;
};

const URL_BASE = "https://navigation.invalid";

const toRelativeHref = (url: URL) => `${url.pathname}${url.search}${url.hash}`;

const normalizePath = (path: string) => {
  const normalized = path.replace(/\/+$/, "");
  return normalized || "/";
};

export const buildConversationNavigationHref = (currentHref: string, target: TConversationNavigationTarget): string => {
  const currentURL = new URL(currentHref, URL_BASE);
  const params = currentURL.searchParams;

  const queryParams: Array<[string, string | null]> = [
    [CHAT_CHANNEL_QUERY_PARAM, target.channelId],
    [CHAT_THREAD_QUERY_PARAM, target.threadId],
    [CHAT_MESSAGE_QUERY_PARAM, target.messageId],
  ];
  for (const [key, value] of queryParams) {
    if (value) params.set(key, value);
    else params.delete(key);
  }

  currentURL.search = params.toString();
  return toRelativeHref(currentURL);
};

export const isExternalNavigationHref = (href: string, origin: string | null): boolean => {
  if (!origin) return true;
  try {
    return new URL(href, origin).origin !== origin;
  } catch {
    return true;
  }
};

export const getConversationSourceNavigationHref = (
  currentHref: string,
  sourceHref: string,
  workspaceSlug: string,
  origin: string | null
): string | null => {
  if (!workspaceSlug || !origin) return null;

  try {
    const currentURL = new URL(currentHref, origin);
    const sourceURL = new URL(sourceHref, origin);
    if (sourceURL.origin !== currentURL.origin) return null;
    if (normalizePath(sourceURL.pathname) !== normalizePath(`/${workspaceSlug}`)) return null;

    const channelId = sourceURL.searchParams.get(CHAT_CHANNEL_QUERY_PARAM);
    if (!channelId) return null;

    return buildConversationNavigationHref(currentHref, {
      channelId,
      threadId: sourceURL.searchParams.get(CHAT_THREAD_QUERY_PARAM),
      messageId: sourceURL.searchParams.get(CHAT_MESSAGE_QUERY_PARAM),
    });
  } catch {
    return null;
  }
};
