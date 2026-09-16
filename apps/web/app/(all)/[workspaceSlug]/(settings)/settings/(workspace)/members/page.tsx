/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useRouter, useSearchParams } from "next/navigation";
// types
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { SearchIcon } from "@plane/propel/icons";
import { Tabs } from "@plane/propel/tabs";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IWorkspaceBulkInviteFormData } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { CountChip } from "@/components/common/count-chip";
import { PageHead } from "@/components/core/page-title";
import { MemberListFiltersDropdown } from "@/components/project/dropdowns/filters/member-list";
import { WorkspaceMembersList } from "@/components/workspace/settings/members-list";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SendWorkspaceInvitationModal } from "@/components/workspace/members";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUserPermissions } from "@/hooks/store/user";
import { useQueryParams } from "@/hooks/use-query-params";
import { isNativeAgent } from "@/store/member/utils";
// local imports
import type { Route } from "./+types/page";
import { MembersWorkspaceSettingsHeader } from "./header";

type TMembersTab = "people" | "agents";

const WorkspaceMembersSettingsPage = observer(function WorkspaceMembersSettingsPage({ params }: Route.ComponentProps) {
  // states
  const [inviteModal, setInviteModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  // router
  const { workspaceSlug } = params;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { updateQueryParams } = useQueryParams();
  const activeTab: TMembersTab = searchParams.get("tab") === "agents" ? "agents" : "people";
  // store hooks
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const {
    workspace: { workspaceMemberIds, getWorkspaceMemberDetails, inviteMembersToWorkspace, filtersStore },
  } = useMember();
  const { currentWorkspace } = useWorkspace();
  const { t } = useTranslation();

  // derived values
  const canPerformWorkspaceAdminActions = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  const canPerformWorkspaceMemberActions = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  const handleWorkspaceInvite = async (data: IWorkspaceBulkInviteFormData) => {
    try {
      await inviteMembersToWorkspace(workspaceSlug, data);

      setInviteModal(false);

      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Success!",
        message: t("workspace_settings.settings.members.invitations_sent_successfully"),
      });
    } catch (error: unknown) {
      let message = undefined;
      if (error instanceof Error) {
        const err = error as Error & { error?: string };
        message = err.error;
      }
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Error!",
        message: `${message ?? t("something_went_wrong_please_try_again")}`,
      });

      throw error;
    }
  };

  // Handler for role filter updates
  const handleRoleFilterUpdate = (role: string) => {
    const currentFilters = filtersStore.filters;
    const currentRoles = currentFilters?.roles || [];
    const updatedRoles = currentRoles.includes(role) ? currentRoles.filter((r) => r !== role) : [...currentRoles, role];

    filtersStore.updateFilters({
      roles: updatedRoles.length > 0 ? updatedRoles : undefined,
    });
  };

  // derived values
  const pageTitle = currentWorkspace?.name ? `${currentWorkspace.name} - Members` : undefined;
  const appliedRoleFilters = filtersStore.filters?.roles || [];
  const memberCount =
    workspaceMemberIds?.filter((memberId) => {
      const details = getWorkspaceMemberDetails(memberId);
      return details && (activeTab === "agents" ? isNativeAgent(details.member) : !isNativeAgent(details.member));
    }).length ?? 0;

  const handleTabChange = (value: string) => {
    const nextTab: TMembersTab = value === "agents" ? "agents" : "people";
    const route =
      nextTab === "agents"
        ? updateQueryParams({ paramsToAdd: { tab: "agents" } })
        : updateQueryParams({ paramsToRemove: ["tab"] });
    router.push(route);
  };

  // if user is not authorized to view this page
  if (workspaceUserInfo && !canPerformWorkspaceMemberActions) {
    return <NotAuthorizedView section="settings" className="h-auto" />;
  }

  return (
    <SettingsContentWrapper header={<MembersWorkspaceSettingsHeader />} hugging>
      <PageHead title={pageTitle} />
      <SendWorkspaceInvitationModal
        isOpen={inviteModal}
        onClose={() => setInviteModal(false)}
        onSubmit={handleWorkspaceInvite}
      />
      <section
        className={cn("size-full", {
          "opacity-60": !canPerformWorkspaceMemberActions,
        })}
      >
        <div className="flex items-center justify-between gap-4 pb-3.5">
          <div className="flex min-w-0 items-center gap-4">
            <h4 className="flex items-center gap-2.5 text-h3-medium">
              {t("workspace_settings.settings.members.title")}
              {memberCount > 0 && <CountChip count={memberCount} className="m-auto h-5" />}
            </h4>
            <Tabs value={activeTab} onValueChange={handleTabChange} className="h-auto w-auto shrink-0">
              <Tabs.List className="h-8" background="contained">
                <Tabs.Trigger size="sm" value="people">
                  {t("workspace_settings.settings.members.tabs.people")}
                </Tabs.Trigger>
                <Tabs.Trigger size="sm" value="agents">
                  {t("workspace_settings.settings.members.tabs.agents")}
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-subtle bg-surface-1 px-2.5 py-1.5">
              <SearchIcon className="h-3.5 w-3.5 text-placeholder" />
              <input
                className="w-full max-w-[234px] border-none bg-transparent text-body-xs-regular outline-none placeholder:text-placeholder"
                placeholder={`${t("search")}...`}
                value={searchQuery}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {activeTab === "people" && (
              <MemberListFiltersDropdown
                appliedFilters={appliedRoleFilters}
                handleUpdate={handleRoleFilterUpdate}
                memberType="workspace"
              />
            )}
            {activeTab === "people" && canPerformWorkspaceAdminActions && (
              <Button variant="primary" size="lg" onClick={() => setInviteModal(true)}>
                {t("workspace_settings.settings.members.add_member")}
              </Button>
            )}
          </div>
        </div>
        <WorkspaceMembersList
          searchQuery={searchQuery}
          isAdmin={canPerformWorkspaceAdminActions}
          memberTab={activeTab}
        />
      </section>
    </SettingsContentWrapper>
  );
});

export default WorkspaceMembersSettingsPage;
