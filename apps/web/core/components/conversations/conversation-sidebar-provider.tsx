/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { observer } from "mobx-react";
import type { TChatSidebarActions, TChatSidebarState } from "./conversation-sidebar-state";
import { useChatSidebarState } from "./conversation-sidebar-state";
import { useUser } from "@/hooks/store/user";

type TConversationSidebarContext = {
  chatSidebarState: TChatSidebarState;
  chatSidebarActions: TChatSidebarActions;
};

const ConversationSidebarContext = createContext<TConversationSidebarContext | null>(null);

type TConversationSidebarProviderProps = {
  workspaceSlug: string;
  children: ReactNode;
};

export const ConversationSidebarProvider = observer(function ConversationSidebarProvider(
  props: TConversationSidebarProviderProps
) {
  const { children, workspaceSlug } = props;
  const { data: currentUser } = useUser();
  const userId = currentUser?.id ?? null;

  return (
    <ConversationSidebarStateProvider
      key={`${workspaceSlug}:${userId ?? "unknown"}`}
      userId={userId}
      workspaceSlug={workspaceSlug}
    >
      {children}
    </ConversationSidebarStateProvider>
  );
});

const ConversationSidebarStateProvider = function ConversationSidebarStateProvider({
  children,
  userId,
  workspaceSlug,
}: TConversationSidebarProviderProps & { userId: string | null }) {
  const [chatSidebarState, chatSidebarActions] = useChatSidebarState(workspaceSlug, userId);
  const contextValue = useMemo(
    () => ({ chatSidebarActions, chatSidebarState }),
    [chatSidebarActions, chatSidebarState]
  );

  return <ConversationSidebarContext.Provider value={contextValue}>{children}</ConversationSidebarContext.Provider>;
};

export const useConversationSidebar = (): TConversationSidebarContext => {
  const context = useContext(ConversationSidebarContext);
  if (!context) throw new Error("useConversationSidebar must be used within ConversationSidebarProvider");
  return context;
};
