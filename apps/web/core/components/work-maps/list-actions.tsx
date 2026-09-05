/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useState } from "react";
import { ArchiveRestoreIcon, Earth, Info, LockKeyhole, LockKeyholeOpen, Minus, Pencil } from "lucide-react";
import { ArchiveIcon, CopyIcon, LinkIcon, LockIcon, NewTabIcon, TrashIcon } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TWorkMap } from "@plane/types";
import { renderFormattedDate } from "@plane/utils";
import { AlertModalCore, CustomMenu } from "@plane/ui";
import { useAppRouter } from "@/hooks/use-app-router";
import { WorkMapService } from "@/services/work-map.service";

const service = new WorkMapService();

type Props = {
  canEdit: boolean;
  canManage: boolean;
  canChangeAccess: boolean;
  onEdit?: () => void;
  projectId: string;
  refresh: () => Promise<unknown>;
  workMap: TWorkMap;
  workspaceSlug: string;
  onDeleted?: () => void;
};

export function WorkMapListActions({
  canEdit,
  canManage,
  canChangeAccess,
  onEdit,
  projectId,
  refresh,
  workMap,
  workspaceSlug,
}: Props) {
  return (
    <>
      <Tooltip tooltipContent={workMap.access === 0 ? "Public" : "Private"}>
        <span className="text-tertiary">
          {workMap.access === 0 ? <Earth className="size-4" /> : <LockIcon className="size-4" />}
        </span>
      </Tooltip>
      <Minus className="-mx-3 size-5 rotate-90 text-placeholder" strokeWidth={1} />
      <Tooltip tooltipContent={`Created on ${renderFormattedDate(workMap.created_at)}`}>
        <span className="grid size-4 cursor-default place-items-center">
          <Info className="size-4 text-tertiary" />
        </span>
      </Tooltip>
      <WorkMapActionsMenu
        canEdit={canEdit}
        canManage={canManage}
        canChangeAccess={canChangeAccess}
        onEdit={onEdit}
        projectId={projectId}
        refresh={refresh}
        workMap={workMap}
        workspaceSlug={workspaceSlug}
      />
    </>
  );
}

export function WorkMapActionsMenu({
  canEdit,
  canManage,
  canChangeAccess,
  onEdit,
  projectId,
  refresh,
  workMap,
  workspaceSlug,
  onDeleted,
}: Props) {
  const router = useAppRouter();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const href = `/${workspaceSlug}/projects/${projectId}/work-maps/${workMap.id}`;
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await refresh();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Work map could not be updated" });
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await service.deleteWorkMap(workspaceSlug, projectId, workMap.id);
      setDeleteModalOpen(false);
      if (onDeleted) await onDeleted();
      else await refresh();
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Work map removed successfully" });
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Work map could not be deleted" });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <AlertModalCore
        handleClose={() => setDeleteModalOpen(false)}
        handleSubmit={handleDelete}
        isSubmitting={isDeleting}
        isOpen={deleteModalOpen}
        title="Delete Work map"
        content={
          <>
            Are you sure you want to remove work map{" "}
            <span className="font-medium break-words break-all text-primary">
              {workMap.name || "Untitled work map"}
            </span>{" "}
            from this project? If this is the work map&apos;s last project, it will be deleted permanently. This action
            cannot be undone.
          </>
        }
      />
      <CustomMenu placement="bottom-end" ellipsis closeOnSelect>
        <CustomMenu.MenuItem onClick={() => window.open(href, "_blank")} className="flex items-center gap-2">
          <NewTabIcon className="size-3" /> Open in new tab
        </CustomMenu.MenuItem>
        <CustomMenu.MenuItem
          onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${href}`)}
          className="flex items-center gap-2"
        >
          <LinkIcon className="size-3" /> Copy link
        </CustomMenu.MenuItem>
        {canEdit && !workMap.is_locked && !workMap.archived_at && onEdit && (
          <CustomMenu.MenuItem onClick={onEdit} className="flex items-center gap-2">
            <Pencil className="size-3" /> Edit details
          </CustomMenu.MenuItem>
        )}
        {canEdit && (
          <CustomMenu.MenuItem
            onClick={async () => {
              const duplicate = await service.duplicate(workspaceSlug, projectId, workMap.id);
              router.push(`/${workspaceSlug}/projects/${projectId}/work-maps/${duplicate.id}`);
            }}
            className="flex items-center gap-2"
          >
            <CopyIcon className="size-3" /> Make a copy
          </CustomMenu.MenuItem>
        )}
        {canEdit && !workMap.archived_at && (
          <CustomMenu.MenuItem
            onClick={() => void run(() => service.setLocked(workspaceSlug, projectId, workMap.id, !workMap.is_locked))}
            className="flex items-center gap-2"
          >
            {workMap.is_locked ? <LockKeyholeOpen className="size-3" /> : <LockKeyhole className="size-3" />}
            {workMap.is_locked ? "Unlock" : "Lock"}
          </CustomMenu.MenuItem>
        )}
        {canChangeAccess && !workMap.archived_at && (
          <CustomMenu.MenuItem
            onClick={() =>
              void run(() =>
                service.update(workspaceSlug, projectId, workMap.id, { access: workMap.access === 0 ? 1 : 0 })
              )
            }
            className="flex items-center gap-2"
          >
            {workMap.access === 0 ? <LockIcon className="size-3" /> : <Earth className="size-3" />}
            {workMap.access === 0 ? "Make private" : "Make public"}
          </CustomMenu.MenuItem>
        )}
        {canManage && (
          <CustomMenu.MenuItem
            onClick={() =>
              void run(() => service.setArchived(workspaceSlug, projectId, workMap.id, !workMap.archived_at))
            }
            className="flex items-center gap-2"
          >
            {workMap.archived_at ? <ArchiveRestoreIcon className="size-3" /> : <ArchiveIcon className="size-3" />}
            {workMap.archived_at ? "Restore" : "Archive"}
          </CustomMenu.MenuItem>
        )}
        {canManage && workMap.archived_at && (
          <CustomMenu.MenuItem onClick={() => setDeleteModalOpen(true)} className="flex items-center gap-2">
            <TrashIcon className="size-3" /> Delete
          </CustomMenu.MenuItem>
        )}
      </CustomMenu>
    </>
  );
}
