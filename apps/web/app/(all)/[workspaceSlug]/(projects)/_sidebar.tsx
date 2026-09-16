/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { useParams, usePathname } from "next/navigation";
import { SIDEBAR_WIDTH } from "@plane/constants";
import { useLocalStorage } from "@plane/hooks";
// components
import { ResizableSidebar } from "@/components/sidebar/resizable-sidebar";
import type { TChatSidebarActions, TChatSidebarState } from "@/components/conversations/conversation-sidebar-state";
import { useConversationSidebar } from "@/components/conversations/conversation-sidebar-provider";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
// local imports
import { ExtendedAppSidebar } from "./extended-sidebar";
import { AppSidebar } from "./sidebar";

export const ProjectAppSidebar = observer(function ProjectAppSidebar() {
  const { chatSidebarActions, chatSidebarState } = useConversationSidebar();

  return <ProjectAppSidebarContent chatSidebarActions={chatSidebarActions} chatSidebarState={chatSidebarState} />;
});

const ProjectAppSidebarContent = observer(function ProjectAppSidebarContent({
  chatSidebarActions,
  chatSidebarState,
}: {
  chatSidebarActions: TChatSidebarActions;
  chatSidebarState: TChatSidebarState;
}) {
  // store hooks
  const {
    sidebarCollapsed,
    toggleSidebar,
    sidebarPeek,
    toggleSidebarPeek,
    isExtendedSidebarOpened,
    isAnySidebarDropdownOpen,
  } = useAppTheme();
  const { storedValue, setValue } = useLocalStorage("sidebarWidth", SIDEBAR_WIDTH);
  // states
  const [sidebarWidth, setSidebarWidth] = useState<number>(storedValue ?? SIDEBAR_WIDTH);
  // routes
  const { workspaceSlug } = useParams();
  const pathname = usePathname();
  // derived values
  const isAnyExtendedSidebarOpen = isExtendedSidebarOpened;

  const isNotificationsPath = pathname.includes(`/${workspaceSlug?.toString() ?? ""}/notifications`);

  // handlers
  const handleWidthChange = (width: number) => setValue(width);

  if (isNotificationsPath) return null;

  return (
    <>
      <ResizableSidebar
        showPeek={sidebarPeek}
        defaultWidth={storedValue ?? 250}
        width={sidebarWidth}
        setWidth={setSidebarWidth}
        defaultCollapsed={sidebarCollapsed}
        peekDuration={1500}
        onWidthChange={handleWidthChange}
        onCollapsedChange={toggleSidebar}
        isCollapsed={sidebarCollapsed}
        toggleCollapsed={toggleSidebar}
        togglePeek={toggleSidebarPeek}
        extendedSidebar={
          <>
            <ExtendedAppSidebar />
          </>
        }
        isAnyExtendedSidebarExpanded={isAnyExtendedSidebarOpen}
        isAnySidebarDropdownOpen={isAnySidebarDropdownOpen}
      >
        <AppSidebar chatSidebarActions={chatSidebarActions} chatSidebarState={chatSidebarState} />
      </ResizableSidebar>
    </>
  );
});
