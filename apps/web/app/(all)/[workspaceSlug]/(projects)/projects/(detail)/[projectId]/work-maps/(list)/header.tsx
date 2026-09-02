/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Map } from "lucide-react";
import { EUserPermissionsLevel } from "@plane/constants";
import { Button } from "@plane/propel/button";
import { EUserProjectRoles } from "@plane/types";
import { Breadcrumbs, Header } from "@plane/ui";
import { CommonProjectBreadcrumbs } from "@/components/breadcrumbs/common";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { useUserPermissions } from "@/hooks/store/user";
import { useWorkMap } from "@/hooks/store/use-work-map";
import { useAppRouter } from "@/hooks/use-app-router";

export const WorkMapListHeader = observer(function WorkMapListHeader() {
  const { workspaceSlug, projectId } = useParams();
  const router = useAppRouter();
  const store = useWorkMap();
  const { allowPermissions } = useUserPermissions();
  const [creating, setCreating] = useState(false);
  const canCreate = allowPermissions(
    [EUserProjectRoles.ADMIN, EUserProjectRoles.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug?.toString() ?? "",
    projectId?.toString() ?? ""
  );

  const create = async () => {
    if (!workspaceSlug || !projectId) return;
    setCreating(true);
    try {
      const map = await store.create(workspaceSlug.toString(), projectId.toString(), "Untitled work map");
      router.push(`/${workspaceSlug}/projects/${projectId}/work-maps/${map.id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs>
          <CommonProjectBreadcrumbs workspaceSlug={workspaceSlug?.toString()} projectId={projectId?.toString()} />
          <Breadcrumbs.Item
            isLast
            component={
              <BreadcrumbLink
                isLast
                label="Work Maps"
                href={`/${workspaceSlug}/projects/${projectId}/work-maps`}
                icon={<Map className="size-4 text-tertiary" />}
              />
            }
          />
        </Breadcrumbs>
      </Header.LeftItem>
      {canCreate && (
        <Header.RightItem>
          <Button variant="primary" size="lg" loading={creating} onClick={() => void create()}>
            Add Work Map
          </Button>
        </Header.RightItem>
      )}
    </Header>
  );
});
