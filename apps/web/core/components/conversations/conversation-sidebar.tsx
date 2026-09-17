/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TConversationCreationOrigin } from "@plane/types";
import { ChannelList } from "./conversation-channel-list";
import { RootMessages, ThreadPanel } from "./conversation-thread-panel";
import type { TChatSidebarActions, TChatSidebarState } from "./conversation-sidebar-state";

/**
 * The root/reply target and nested transcript interactions follow the Apache
 * 2.0-licensed Buzz stable checkout at commit
 * `9ceb1f79bbc21785a0a075c40aecb3c058b1ea15`, specifically
 * `desktop/src/features/messages/ui/MessageThreadPanel.tsx` and
 * `desktop/src/features/messages/lib/threading.ts`. The Plane host keeps its
 * own rows because those components depend on private relay and Tauri contexts;
 * no Buzz source code is imported or copied here.
 */

type TConversationSidebarProps = {
  chatSidebarState: TChatSidebarState;
  chatSidebarActions: TChatSidebarActions;
  onCreateWorkItem?: (origin: TConversationCreationOrigin) => void;
};

export function ConversationSidebar({
  chatSidebarActions,
  chatSidebarState,
  onCreateWorkItem,
}: TConversationSidebarProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {chatSidebarState.openThreadId ? (
        <ThreadPanel actions={chatSidebarActions} onCreateWorkItem={onCreateWorkItem} state={chatSidebarState} />
      ) : (
        <>
          <ChannelList actions={chatSidebarActions} state={chatSidebarState} />
          <RootMessages actions={chatSidebarActions} onCreateWorkItem={onCreateWorkItem} state={chatSidebarState} />
        </>
      )}
    </div>
  );
}

export type { TConversationSidebarProps };
