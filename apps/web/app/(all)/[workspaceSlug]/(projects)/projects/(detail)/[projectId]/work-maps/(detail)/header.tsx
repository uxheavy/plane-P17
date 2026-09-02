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
import { Map } from "lucide-react";
import { Breadcrumbs, Header } from "@plane/ui";
import { CommonProjectBreadcrumbs } from "@/components/breadcrumbs/common";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { useWorkMap } from "@/hooks/store/use-work-map";

export const WorkMapDetailsHeader = observer(function WorkMapDetailsHeader() {
  const { workspaceSlug, projectId, workMapId } = useParams();
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
    </Header>
  );
});
