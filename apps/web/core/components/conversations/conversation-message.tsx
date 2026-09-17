/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { ChevronDown, ChevronRight, FileText, MessageCircle, Reply } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import { WorkItemsIcon } from "@plane/propel/icons";
import type { IConversationAttachment, IConversationMessage } from "@plane/types";
import { Avatar } from "@plane/ui";
import { cn, formatLocalizedTimestamp, getFileURL } from "@plane/utils";
import { useUser } from "@/hooks/store/user";

export const getAuthorName = (message: IConversationMessage, fallback: string) =>
  message.author.display_name || fallback;

const RASTER_PREVIEW_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

function MessageAttachments({ attachments }: { attachments: IConversationAttachment[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => {
        const fileURL = getFileURL(attachment.asset_url);
        if (!fileURL) return null;
        const isRasterPreview = RASTER_PREVIEW_MIME_TYPES.has(attachment.mime_type.toLowerCase());
        return (
          <a
            className="group flex max-w-full items-center gap-1.5 rounded border border-subtle bg-surface-2 px-2 py-1 text-10 text-secondary hover:border-strong hover:text-primary"
            download={attachment.name}
            href={fileURL}
            key={attachment.asset_id}
            rel="noreferrer"
            target="_blank"
          >
            {isRasterPreview ? (
              <img alt={attachment.name} className="size-10 rounded object-cover" src={fileURL} />
            ) : (
              <FileText className="size-3.5 shrink-0 text-tertiary" />
            )}
            <span className="max-w-40 truncate" title={attachment.name}>
              {attachment.name}
            </span>
          </a>
        );
      })}
    </div>
  );
}

export const MessageCard = observer(function MessageCard({
  message,
  depth = 0,
  isReplyTarget = false,
  isSelected = false,
  isBranchExpanded = true,
  branchReplyCount = 0,
  replyCount = 0,
  onOpenThread,
  onReply,
  onToggleBranch,
}: {
  message: IConversationMessage;
  depth?: number;
  isRoot?: boolean;
  isReplyTarget?: boolean;
  isSelected?: boolean;
  isBranchExpanded?: boolean;
  branchReplyCount?: number;
  replyCount?: number;
  onOpenThread?: () => void;
  onReply?: () => void;
  onToggleBranch?: () => void;
}) {
  const { currentLocale, t } = useTranslation();
  const { data: user } = useUser();
  const { workspaceSlug } = useParams();
  const authorName = getAuthorName(message, t("common.unknown_user"));
  const userTimezone = user?.user_timezone || "UTC";
  const messageTime = formatLocalizedTimestamp(message.created_at, currentLocale, userTimezone, "time") ?? "";
  const messageDateTime =
    formatLocalizedTimestamp(message.created_at, currentLocale, userTimezone, "dateTime") ?? message.created_at;
  return (
    <article
      data-chat-message-id={message.id}
      id={`chat-message-${message.id}`}
      className={cn(
        "group/message relative px-2.5 py-2 transition-colors focus-within:bg-layer-transparent-hover hover:bg-layer-transparent-hover",
        isSelected ? "ring-accent-primary bg-accent-primary/10 ring-1" : isReplyTarget ? "bg-accent-primary/5" : ""
      )}
      style={{ marginLeft: `${Math.min(depth, 4) * 12}px` }}
    >
      {message.created_work_item ? (
        <div className="flex min-w-0 items-center gap-2 text-12 text-secondary">
          <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-subtle bg-layer-2 text-secondary shadow-raised-100">
            <WorkItemsIcon width={14} height={14} aria-hidden="true" />
          </div>
          <div className="min-w-0 break-words">
            <p>
              {t("sidebar.chat.created_work_item", { actor: authorName })}{" "}
              <Link
                className="font-medium text-primary hover:underline"
                href={`/${workspaceSlug?.toString()}/projects/${message.created_work_item.project_id}/issues/${message.created_work_item.id}`}
                title={message.created_work_item.name}
              >
                {message.created_work_item.name}
              </Link>
            </p>
            <time
              className="mt-0.5 block w-fit text-10 whitespace-nowrap text-tertiary"
              dateTime={message.created_at}
              title={messageDateTime}
            >
              {messageTime}
            </time>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <Avatar className="shrink-0" name={authorName} size="sm" src={getFileURL(message.author.avatar_url ?? "")} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-12 font-medium text-primary">{authorName}</span>
              <time
                className="shrink-0 text-10 whitespace-nowrap text-tertiary"
                dateTime={message.created_at}
                title={messageDateTime}
              >
                {messageTime}
              </time>
            </div>
            {message.content && (
              <p className="mt-1 text-12 leading-5 break-words whitespace-pre-wrap text-secondary">{message.content}</p>
            )}
            {message.attachments?.length > 0 && <MessageAttachments attachments={message.attachments} />}
          </div>
        </div>
      )}
      {!message.created_work_item && (onReply || onOpenThread || onToggleBranch) && (
        <div
          className={cn(
            "absolute top-1 right-2 z-10 -m-1 p-1 transition-opacity duration-150 ease-out",
            "opacity-100 sm:pointer-events-none sm:opacity-0",
            "sm:group-hover/message:pointer-events-auto sm:group-hover/message:opacity-100",
            "sm:group-focus-within/message:pointer-events-auto sm:group-focus-within/message:opacity-100"
          )}
        >
          <div className="overflow-hidden rounded-full border border-strong/70 bg-surface-1/95 shadow-raised-100 backdrop-blur-sm">
            <div className="flex items-center gap-0.5 p-1">
              {onReply && (
                <button
                  aria-label={t("common.actions.reply")}
                  className="inline-flex size-7 items-center justify-center gap-1 rounded-full px-1.5 text-10 font-medium text-tertiary hover:bg-layer-transparent-hover hover:text-primary"
                  onClick={onReply}
                  type="button"
                >
                  <Reply className="size-3.5 shrink-0" />
                  <span className="sr-only">{t("common.actions.reply")}</span>
                </button>
              )}
              {onOpenThread && replyCount > 0 && (
                <button
                  aria-label={t("sidebar.chat.expand_replies", { count: replyCount })}
                  className="inline-flex size-7 items-center justify-center gap-1 rounded-full px-1.5 text-10 font-medium text-tertiary hover:bg-layer-transparent-hover hover:text-primary"
                  onClick={onOpenThread}
                  type="button"
                >
                  <MessageCircle className="size-3.5 shrink-0" />
                  <span className="sr-only">{t("sidebar.chat.expand_replies", { count: replyCount })}</span>
                </button>
              )}
              {onToggleBranch && branchReplyCount > 0 && (
                <button
                  aria-expanded={isBranchExpanded}
                  aria-label={
                    isBranchExpanded
                      ? t("sidebar.chat.collapse_replies")
                      : t("sidebar.chat.expand_replies", { count: branchReplyCount })
                  }
                  className="inline-flex size-7 items-center justify-center gap-1 rounded-full px-1.5 text-10 font-medium text-tertiary hover:bg-layer-transparent-hover hover:text-primary"
                  onClick={onToggleBranch}
                  type="button"
                >
                  {isBranchExpanded ? (
                    <ChevronDown className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0" />
                  )}
                  <span className="sr-only">
                    {isBranchExpanded
                      ? t("sidebar.chat.collapse_replies")
                      : t("sidebar.chat.expand_replies", { count: branchReplyCount })}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
});
