/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import { WorkMapIcon } from "@plane/propel/icons";
import { Breadcrumbs, Header } from "@plane/ui";
import { CommonProjectBreadcrumbs } from "@/components/breadcrumbs/common";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { WorkMapHeaderActions } from "@/components/work-maps/header-actions";
import { useWorkMap } from "@/hooks/store/use-work-map";

export const WorkMapDetailsHeader = observer(function WorkMapDetailsHeader() {
  const { t } = useTranslation();
  const { workspaceSlug, projectId, workMapId } = useParams();
  const store = useWorkMap();
  const { maps } = store;
  const workMap = maps[workMapId?.toString() ?? ""];
  const resolvedWorkspaceSlug = workspaceSlug?.toString() ?? "";
  const resolvedProjectId = projectId?.toString() ?? "";
  const resolvedWorkMapId = workMapId?.toString() ?? "";
  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs>
          <CommonProjectBreadcrumbs workspaceSlug={workspaceSlug?.toString()} projectId={projectId?.toString()} />
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                label={t("sidebar.work_maps")}
                href={`/${workspaceSlug}/projects/${projectId}/work-maps`}
                icon={<WorkMapIcon className="size-4 text-tertiary" />}
              />
            }
          />
          <Breadcrumbs.Item isLast component={<BreadcrumbLink isLast label={workMap?.name || "Work map"} />} />
        </Breadcrumbs>
      </Header.LeftItem>
      {workMap && (
        <Header.RightItem>
          <WorkMapHeaderActions
            workspaceSlug={resolvedWorkspaceSlug}
            projectId={resolvedProjectId}
            workMap={workMap}
            refresh={() => store.fetchById(resolvedWorkspaceSlug, resolvedProjectId, resolvedWorkMapId)}
          />
        </Header.RightItem>
      )}
    </Header>
  );
});
