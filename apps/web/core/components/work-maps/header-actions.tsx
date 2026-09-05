/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { CheckIcon, LinkIcon } from "@plane/propel/icons";
import { IconButton } from "@plane/propel/icon-button";
import { Tooltip } from "@plane/propel/tooltip";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TWorkMap } from "@plane/types";
import { EUserProjectRoles } from "@plane/types";
import { EUserPermissionsLevel } from "@plane/constants";
import { LockKeyhole, LockKeyholeOpen, Star } from "lucide-react";
import { useUser } from "@/hooks/store/user";
import { useUserPermissions } from "@/hooks/store/user";
import { useAppRouter } from "@/hooks/use-app-router";
import { WorkMapService } from "@/services/work-map.service";
import { CreateUpdateWorkMapModal } from "./create-update-modal";
import { WorkMapActionsMenu } from "./list-actions";

const service = new WorkMapService();

type Props = {
  projectId: string;
  refresh: () => Promise<unknown>;
  workMap: TWorkMap;
  workspaceSlug: string;
};

export const WorkMapHeaderActions = observer(function WorkMapHeaderActions({
  projectId,
  refresh,
  workMap,
  workspaceSlug,
}: Props) {
  const { data: user } = useUser();
  const { allowPermissions } = useUserPermissions();
  const router = useAppRouter();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canEdit = allowPermissions(
    [EUserProjectRoles.ADMIN, EUserProjectRoles.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );
  const canChangeAccess = workMap.owned_by === user?.id;
  const canManage =
    allowPermissions([EUserProjectRoles.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId) ||
    workMap.owned_by === user?.id;
  const href = `/${workspaceSlug}/projects/${projectId}/work-maps/${workMap.id}`;
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Work map could not be updated" });
    }
  };

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    []
  );

  const copyLink = () => {
    void navigator.clipboard.writeText(`${window.location.origin}${href}`);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1000);
  };

  return (
    <>
      <CreateUpdateWorkMapModal
        canChangeAccess={canChangeAccess}
        isOpen={editing}
        onClose={() => setEditing(false)}
        onCompleted={refresh}
        projectId={projectId}
        workMap={workMap}
        workspaceSlug={workspaceSlug}
      />
      <div className="flex items-center gap-1">
        {canEdit && !workMap.archived_at && (
          <Tooltip tooltipContent={workMap.is_locked ? "Unlock" : "Lock"} position="bottom">
            <IconButton
              variant="ghost"
              size="lg"
              icon={workMap.is_locked ? LockKeyholeOpen : LockKeyhole}
              onClick={() =>
                void run(() => service.setLocked(workspaceSlug, projectId, workMap.id, !workMap.is_locked))
              }
              aria-label={workMap.is_locked ? "Unlock" : "Lock"}
              className={workMap.is_locked ? "text-accent-primary" : ""}
            />
          </Tooltip>
        )}
        <Tooltip tooltipContent={copied ? "Copied!" : "Copy link"} position="bottom">
          <IconButton
            variant="ghost"
            size="lg"
            icon={copied ? CheckIcon : LinkIcon}
            onClick={copyLink}
            aria-label={copied ? "Copied link" : "Copy link"}
            className={copied ? "text-success-primary" : ""}
          />
        </Tooltip>
        {canEdit && !workMap.archived_at && (
          <IconButton
            variant="ghost"
            size="lg"
            icon={Star}
            onClick={() =>
              void run(() => service.setFavorite(workspaceSlug, projectId, workMap.id, !workMap.is_favorite))
            }
            aria-label={workMap.is_favorite ? "Remove favorite" : "Add to favorites"}
            className={
              workMap.is_favorite
                ? "[&_svg]:fill-(--color-label-yellow-icon) [&_svg]:stroke-(--color-label-yellow-icon)"
                : ""
            }
          />
        )}
        <WorkMapActionsMenu
          canEdit={canEdit}
          canManage={canManage}
          canChangeAccess={canChangeAccess}
          onEdit={() => setEditing(true)}
          projectId={projectId}
          refresh={refresh}
          workMap={workMap}
          workspaceSlug={workspaceSlug}
          onDeleted={() => router.push(`/${workspaceSlug}/projects/${projectId}/work-maps`)}
        />
      </div>
    </>
  );
});
