/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useMemo } from "react";
import { isEmpty } from "lodash-es";
import { MessageCircle } from "lucide-react";
import { observer } from "mobx-react";
// plane helpers
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { ProjectIcon } from "@plane/propel/icons";
import { Tabs } from "@plane/propel/tabs";
import { Tooltip } from "@plane/propel/tooltip";
import type { TConversationCreationOrigin } from "@plane/types";
// components
import { ConversationProposalPicker } from "@/components/conversations/conversation-proposal-picker";
import { ConversationSidebar } from "@/components/conversations/conversation-sidebar";
import type { TChatSidebarActions, TChatSidebarState } from "@/components/conversations/conversation-sidebar-state";
import { CreateUpdateIssueModal } from "@/components/issues/issue-modal/modal";
import { SidebarWrapper } from "@/components/sidebar/sidebar-wrapper";
import { SidebarFavoritesMenu } from "@/components/workspace/sidebar/favorites/favorites-menu";
import { SidebarProjectsList } from "@/components/workspace/sidebar/projects-list";
import { SidebarQuickActions } from "@/components/workspace/sidebar/quick-actions";
import { SidebarMenuItems } from "@/components/workspace/sidebar/sidebar-menu-items";
// hooks
import { useFavorite } from "@/hooks/store/use-favorite";
import { useMember } from "@/hooks/store/use-member";
import { useUser, useUserPermissions } from "@/hooks/store/user";
import { isNativeAgent } from "@/store/member/utils";

type TAppSidebarProps = {
  chatSidebarState: TChatSidebarState;
  chatSidebarActions: TChatSidebarActions;
};

export const AppSidebar = observer(function AppSidebar({ chatSidebarActions, chatSidebarState }: TAppSidebarProps) {
  // store hooks
  const { allowPermissions } = useUserPermissions();
  const { projectsWithCreatePermissions } = useUser();
  const {
    workspace: { getWorkspaceMemberDetails, workspaceMemberIds },
  } = useMember();
  const { groupedFavorites } = useFavorite();
  const { t } = useTranslation();

  // derived values
  const canPerformWorkspaceMemberActions = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  const isFavoriteEmpty = isEmpty(groupedFavorites);
  const isChatTabActive = chatSidebarState.activeTab === "chat";
  const allowedProjectIds = Object.keys(projectsWithCreatePermissions ?? {});
  const workItemProposal = chatSidebarState.conversationProposal;
  const nativeAgentIds = (workspaceMemberIds ?? []).filter((memberId) => {
    const member = getWorkspaceMemberDetails(memberId);
    return member?.is_active !== false && isNativeAgent(member?.member);
  });

  const handleCreateWorkItem = useCallback(
    (origin: TConversationCreationOrigin) => {
      if (workItemProposal && workItemProposal.status !== "failed") return;
      if (allowedProjectIds.length === 0) return;
      chatSidebarActions.beginConversationProposal(origin);
    },
    [allowedProjectIds.length, chatSidebarActions, workItemProposal]
  );

  const handleWorkItemClose = useCallback(() => {
    chatSidebarActions.clearConversationProposal();
  }, [chatSidebarActions]);

  const handleWorkItemSubmit = useCallback(async () => {
    if (!workItemProposal) return;
    chatSidebarActions.retryRoots(workItemProposal.origin.channel_id);
    if (workItemProposal.origin.thread_root_id) chatSidebarActions.retryThread(workItemProposal.origin.thread_root_id);
    chatSidebarActions.clearConversationProposal();
  }, [chatSidebarActions, workItemProposal]);

  const sourceWorkItemData = useMemo(
    () => ({
      project_id: allowedProjectIds[0],
      ...(workItemProposal?.result
        ? {
            name: workItemProposal.result.title,
            description_html: workItemProposal.result.description_markdown,
          }
        : {}),
    }),
    [allowedProjectIds, workItemProposal?.result]
  );

  const handleTabChange = (value: string) => {
    if (value === "projects" || value === "chat") chatSidebarActions.setActiveTab(value);
  };

  const modeSwitcher = (
    <Tabs value={chatSidebarState.activeTab} onValueChange={handleTabChange} className="w-fit">
      <Tabs.List className="w-fit justify-start gap-1" background="contained">
        <Tabs.Trigger
          aria-label={t("sidebar.projects")}
          className="w-fit flex-none gap-1"
          size="sm"
          title={isChatTabActive ? t("sidebar.projects") : undefined}
          value="projects"
        >
          {isChatTabActive ? (
            <Tooltip tooltipContent={t("sidebar.projects")}>
              <ProjectIcon aria-hidden="true" className="size-4" />
            </Tooltip>
          ) : (
            <>
              <ProjectIcon aria-hidden="true" className="size-4" />
              <span>{t("sidebar.projects")}</span>
            </>
          )}
        </Tabs.Trigger>
        <Tabs.Trigger
          aria-label={t("sidebar.chat.label")}
          className="w-fit flex-none gap-1"
          size="sm"
          title={!isChatTabActive ? t("sidebar.chat.label") : undefined}
          value="chat"
        >
          {isChatTabActive ? (
            <>
              <MessageCircle aria-hidden="true" className="size-4" />
              <span>{t("sidebar.chat.label")}</span>
            </>
          ) : (
            <Tooltip tooltipContent={t("sidebar.chat.label")}>
              <MessageCircle aria-hidden="true" className="size-4" />
            </Tooltip>
          )}
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs>
  );

  return (
    <SidebarWrapper
      title={modeSwitcher}
      showCustomizeButton
      quickActions={!isChatTabActive ? <SidebarQuickActions /> : undefined}
    >
      {isChatTabActive ? (
        <>
          <ConversationSidebar
            chatSidebarActions={chatSidebarActions}
            chatSidebarState={chatSidebarState}
            onCreateWorkItem={handleCreateWorkItem}
          />
          {workItemProposal && workItemProposal.status !== "completed" && (
            <ConversationProposalPicker
              agentIds={nativeAgentIds}
              onCancel={handleWorkItemClose}
              onSelectAgent={(agentUserId) => void chatSidebarActions.submitConversationProposal(agentUserId)}
              proposal={workItemProposal}
            />
          )}
          <CreateUpdateIssueModal
            allowedProjectIds={allowedProjectIds}
            draftCreationOrigin={workItemProposal?.status === "completed" ? workItemProposal.origin : undefined}
            data={sourceWorkItemData}
            isDraft
            isOpen={workItemProposal?.status === "completed"}
            onClose={handleWorkItemClose}
            onSubmit={handleWorkItemSubmit}
          />
        </>
      ) : (
        <>
          <SidebarMenuItems />
          {/* Favorites Menu */}
          {canPerformWorkspaceMemberActions && !isFavoriteEmpty && <SidebarFavoritesMenu />}
          {/* Projects List */}
          <SidebarProjectsList />
        </>
      )}
    </SidebarWrapper>
  );
});
