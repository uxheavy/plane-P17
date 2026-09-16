/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useCallback, useRef } from "react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TProjectIssuesSearchParams, TWorkMapSource } from "@plane/types";
import { ExistingIssuesListModal } from "@/components/core/modals/existing-issues-list-modal";
import { CreateUpdateIssueModal } from "@/components/issues/issue-modal/modal";
import { WorkMapService } from "@/services/work-map.service";

export type WorkMapPlacementSource = Pick<TWorkMapSource, "source_kind" | "source_id" | "name">;
export type WorkMapWorkItemAction = "create" | "existing";

const service = new WorkMapService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  workMapId: string;
  action: WorkMapWorkItemAction;
  onSelect: (sources: WorkMapPlacementSource[]) => void;
  onClose: () => void;
};

export function WorkMapWorkItemPicker({ workspaceSlug, projectId, workMapId, action, onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const createdSources = useRef<WorkMapPlacementSource[]>([]);
  const creationClosed = useRef(false);
  const search = useCallback(
    async ({ search: query }: TProjectIssuesSearchParams) => {
      try {
        return await service.searchWorkItems(workspaceSlug, projectId, workMapId, query.trim());
      } catch {
        setToast({
          type: TOAST_TYPE.ERROR,
          title: t("error"),
          message: t("entity.fetch.failed", { entity: t("work_items") }),
        });
        return [];
      }
    },
    [workspaceSlug, projectId, workMapId, t]
  );

  if (action === "create") {
    return (
      <CreateUpdateIssueModal
        isOpen
        data={{ project_id: projectId }}
        isProjectSelectionDisabled
        onClose={() => {
          creationClosed.current = true;
          if (createdSources.current.length > 0) onSelect(createdSources.current);
          else onClose();
        }}
        onSubmit={async (issue) => {
          createdSources.current = [
            ...createdSources.current,
            { source_kind: "work-item", source_id: issue.id, name: issue.name },
          ];
          // The native dialog closes before onSubmit, except while Create more is enabled.
          if (creationClosed.current) onSelect(createdSources.current);
        }}
      />
    );
  }

  return (
    <ExistingIssuesListModal
      workspaceSlug={workspaceSlug}
      projectId={projectId}
      isOpen
      searchParams={{}}
      workItemSearchServiceCallback={search}
      handleClose={onClose}
      handleOnSubmit={async (issues) => {
        onSelect(issues.map((issue) => ({ source_kind: "work-item", source_id: issue.id, name: issue.name })));
      }}
    />
  );
}
