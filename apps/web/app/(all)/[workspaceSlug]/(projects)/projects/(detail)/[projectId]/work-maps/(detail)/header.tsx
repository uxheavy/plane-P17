/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Map } from "lucide-react";
import { Button } from "@plane/propel/button";
import { Breadcrumbs, Header } from "@plane/ui";
import { CommonProjectBreadcrumbs } from "@/components/breadcrumbs/common";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { useWorkMap } from "@/hooks/store/use-work-map";
import { useAppRouter } from "@/hooks/use-app-router";
import { WorkMapService } from "@/services/work-map.service";

const service = new WorkMapService();

export const WorkMapDetailsHeader = observer(function WorkMapDetailsHeader() {
  const { workspaceSlug, projectId, workMapId } = useParams();
  const router = useAppRouter();
  const { maps } = useWorkMap();
  const workMap = maps[workMapId?.toString() ?? ""];
  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs>
          <CommonProjectBreadcrumbs workspaceSlug={workspaceSlug?.toString()} projectId={projectId?.toString()} />
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                label="Work Maps"
                href={`/${workspaceSlug}/projects/${projectId}/work-maps`}
                icon={<Map className="size-4 text-tertiary" />}
              />
            }
          />
          <Breadcrumbs.Item isLast component={<BreadcrumbLink isLast label={workMap?.name || "Work Map"} href="#" />} />
        </Breadcrumbs>
      </Header.LeftItem>
      {workMap && (
        <Header.RightItem>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              const duplicate = await service.duplicate(
                workspaceSlug?.toString() ?? "",
                projectId?.toString() ?? "",
                workMap.id
              );
              router.push(`/${workspaceSlug}/projects/${projectId}/work-maps/${duplicate.id}`);
            }}
          >
            Duplicate
          </Button>
        </Header.RightItem>
      )}
    </Header>
  );
});
