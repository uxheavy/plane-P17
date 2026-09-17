/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Plus, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Input } from "@plane/propel/input";
import type { TChatSidebarActions, TChatSidebarState } from "./conversation-sidebar-state";
import { ConversationError } from "./conversation-feedback";

export function ChannelList({ state, actions }: { state: TChatSidebarState; actions: TChatSidebarActions }) {
  const { t } = useTranslation();
  return (
    <section className="flex shrink-0 flex-col gap-1 border-b border-subtle pb-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-10 font-medium tracking-wide text-tertiary uppercase">{t("sidebar.chat.channels")}</span>
        <Button
          aria-label={t("sidebar.chat.new_channel")}
          onClick={() => actions.setChannelFormOpen(!state.isChannelFormOpen)}
          prependIcon={state.isChannelFormOpen ? <X /> : <Plus />}
          size="sm"
          variant="ghost"
        />
      </div>
      {state.channelError ? <ConversationError message={state.channelError} onRetry={actions.retryChannels} /> : null}
      {state.isChannelFormOpen ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            void actions.createChannel();
          }}
        >
          <Input
            aria-label={t("sidebar.chat.channel_name")}
            className="min-w-0 flex-1"
            onChange={(event) => actions.setChannelDraft(event.target.value)}
            placeholder={t("sidebar.chat.channel_name")}
            value={state.channelDraft}
          />
          <Button
            disabled={state.isCreatingChannel || !state.channelDraft.trim()}
            loading={state.isCreatingChannel}
            size="sm"
            type="submit"
          >
            {t("sidebar.chat.create_channel")}
          </Button>
        </form>
      ) : null}
      <div className="flex min-w-0 gap-1 overflow-x-auto">
        {state.channels.length === 0 && !state.loadingChannels ? (
          <span className="px-1 text-11 text-tertiary">{t("sidebar.chat.no_channels")}</span>
        ) : null}
        {state.channels.map((channel) => (
          <button
            aria-pressed={state.selectedChannelId === channel.id}
            className="max-w-full shrink-0 truncate rounded px-2 py-1 text-11 text-secondary hover:bg-layer-transparent-hover hover:text-primary aria-pressed:bg-accent-primary/10 aria-pressed:text-primary"
            key={channel.id}
            onClick={() => actions.selectChannel(channel.id)}
            type="button"
          >
            # {channel.name}
          </button>
        ))}
      </div>
    </section>
  );
}
