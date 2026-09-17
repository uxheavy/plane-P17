/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ChangeEvent, FormEvent } from "react";
import { useRef } from "react";
import { BriefcaseBusiness, CornerUpLeft, File, Image, LoaderCircle, Plus, RotateCcw, Send, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Menu } from "@plane/propel/menu";
import { Tooltip } from "@plane/propel/tooltip";
import { convertBytesToSize } from "@plane/utils";
import type { IConversationMessage } from "@plane/types";
import type { TChatAttachmentDraft, TChatSidebarActions, TChatSidebarState } from "./conversation-sidebar-state";
import { getAuthorName } from "./conversation-message";

export function MessageComposer({
  targetKey,
  parentId,
  placeholder,
  replyTarget,
  onClearReplyTarget,
  onCreateWorkItem,
  state,
  actions,
}: {
  targetKey: string;
  parentId: string | null;
  placeholder: string;
  replyTarget?: IConversationMessage;
  onClearReplyTarget?: () => void;
  onCreateWorkItem?: () => void;
  state: TChatSidebarState;
  actions: TChatSidebarActions;
}) {
  const { t } = useTranslation();
  const draft = state.drafts[targetKey] ?? "";
  const attachmentDrafts = state.attachmentDrafts[targetKey] ?? [];
  const isPending = Boolean(state.pendingSendTargets[targetKey]);
  const sendError = state.sendErrors[targetKey];
  const hasUploadingAttachments = attachmentDrafts.some((attachment) => attachment.status === "uploading");
  const hasFailedAttachments = attachmentDrafts.some((attachment) => attachment.status === "error");
  const hasReadyAttachments = attachmentDrafts.some((attachment) => attachment.status === "ready" && attachment.asset);
  const canSend =
    Boolean(draft.trim() || hasReadyAttachments) && !hasUploadingAttachments && !hasFailedAttachments && !isPending;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) actions.addAttachments(targetKey, Array.from(event.target.files));
    event.target.value = "";
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await actions.sendMessage(targetKey, draft, parentId);
  };

  return (
    <form
      className="relative z-10 flex flex-col gap-2 rounded-2xl border border-subtle bg-surface-1 px-3 pt-3 pb-2 shadow-none"
      onSubmit={handleSubmit}
    >
      {replyTarget && onClearReplyTarget && (
        <div className="relative z-0 -mb-4 flex items-start gap-2 rounded-t-2xl border border-b-0 border-subtle bg-surface-2/70 px-3 pt-2.5 pb-6 text-11 leading-5 text-secondary backdrop-blur-sm">
          <CornerUpLeft aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-primary">
              {t("sidebar.chat.replying_to", { name: getAuthorName(replyTarget, t("common.unknown_user")) })}
            </p>
            {replyTarget.content ? <p className="truncate text-tertiary">{replyTarget.content}</p> : null}
          </div>
          <button
            aria-label={t("sidebar.chat.clear_reply_target")}
            className="-mr-1 size-7 shrink-0 rounded-full p-1.5 text-tertiary hover:bg-layer-transparent-hover hover:text-primary"
            onClick={onClearReplyTarget}
            type="button"
          >
            <X className="size-3.5 shrink-0" />
          </button>
        </div>
      )}
      {sendError && (
        <div
          className="flex items-center justify-between gap-2 rounded-md border border-danger-subtle bg-danger-subtle/40 px-2 py-1.5 text-11 text-danger-secondary"
          role="alert"
        >
          <span className="min-w-0">{sendError}</span>
          {state.sendRetries[targetKey] && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void actions.retrySend(targetKey)}
              prependIcon={<RotateCcw />}
            >
              {t("common.retry")}
            </Button>
          )}
        </div>
      )}
      <textarea
        aria-label={placeholder}
        className="min-h-16 resize-none rounded-md border border-subtle bg-surface-1 px-2.5 py-2 text-12 text-primary outline-none placeholder:text-placeholder focus:border-strong"
        disabled={isPending}
        onChange={(event) =>
          actions.setDraft(targetKey, event.target.value, {
            channelId: state.selectedChannelId ?? "",
            rootId: state.openThreadId,
            parentId,
          })
        }
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSend) event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={placeholder}
        value={draft}
      />
      {attachmentDrafts.length > 0 && (
        <div aria-live="polite" className="flex flex-wrap gap-1.5">
          {attachmentDrafts.map((attachment) => (
            <AttachmentDraftItem
              attachment={attachment}
              disabled={isPending || Boolean(state.sendRetries[targetKey])}
              key={attachment.id}
              onRemove={() => void actions.removeAttachment(targetKey, attachment.id)}
            />
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <Menu
          ariaLabel={t("sidebar.chat.composer_actions")}
          customButton={<Plus className="size-3.5" />}
          customButtonClassName="grid size-6 place-items-center rounded text-tertiary hover:bg-layer-transparent-hover hover:text-primary"
          disabled={isPending}
        >
          <Menu.MenuItem onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2">
            <File className="size-3" />
            <span>{t("sidebar.chat.attach_files")}</span>
          </Menu.MenuItem>
          <Menu.MenuItem onClick={() => imageInputRef.current?.click()} className="flex items-center gap-2">
            <Image className="size-3" />
            <span>{t("sidebar.chat.add_photos")}</span>
          </Menu.MenuItem>
          {onCreateWorkItem && (
            <Menu.MenuItem onClick={onCreateWorkItem} className="flex items-center gap-2">
              <BriefcaseBusiness className="size-3" />
              <span>{t("sidebar.chat.create_work_item")}</span>
            </Menu.MenuItem>
          )}
        </Menu>
        <input ref={fileInputRef} accept="*/*" className="hidden" multiple onChange={handleFilesSelected} type="file" />
        <input
          ref={imageInputRef}
          accept="image/*"
          className="hidden"
          multiple
          onChange={handleFilesSelected}
          type="file"
        />
        <Tooltip tooltipContent={t("sidebar.chat.composer_hint")}>
          <Button
            aria-label={t("sidebar.chat.send")}
            disabled={!canSend}
            loading={isPending}
            prependIcon={<Send />}
            size="sm"
            type="submit"
          />
        </Tooltip>
      </div>
    </form>
  );
}

function AttachmentDraftItem({
  attachment,
  disabled,
  onRemove,
}: {
  attachment: TChatAttachmentDraft;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const errorMessage =
    attachment.error === "attachment_remove_error"
      ? t("sidebar.chat.attachment_remove_error")
      : t("sidebar.chat.attachment_upload_error");

  return (
    <div className="flex max-w-full items-center gap-1.5 rounded border border-subtle bg-surface-2 px-2 py-1 text-10 text-secondary">
      {attachment.status === "uploading" ? (
        <LoaderCircle className="size-3 animate-spin text-tertiary" />
      ) : (
        <File className="size-3 shrink-0 text-tertiary" />
      )}
      <span className="max-w-32 truncate" title={attachment.name}>
        {attachment.name}
      </span>
      <span className="shrink-0 text-tertiary">{convertBytesToSize(attachment.size)}</span>
      {attachment.status === "error" && <span className="shrink-0 text-danger-secondary">{errorMessage}</span>}
      <button
        aria-label={t("sidebar.chat.remove_attachment", { name: attachment.name })}
        className="rounded p-0.5 text-tertiary hover:bg-layer-transparent-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={onRemove}
        type="button"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
