/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import { WorkMapIcon } from "@plane/propel/icons";
import { EUserPermissionsLevel } from "@plane/constants";
import { Button } from "@plane/propel/button";
import { EUserProjectRoles } from "@plane/types";
import { Breadcrumbs, Header } from "@plane/ui";
import { CommonProjectBreadcrumbs } from "@/components/breadcrumbs/common";
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { CreateUpdateWorkMapModal } from "@/components/work-maps/create-update-modal";
import { useUserPermissions } from "@/hooks/store/user";

export const WorkMapListHeader = observer(function WorkMapListHeader() {
  const { t } = useTranslation();
  const { workspaceSlug, projectId } = useParams();
  const { allowPermissions } = useUserPermissions();
  const [creating, setCreating] = useState(false);
  const canCreate = allowPermissions(
    [EUserProjectRoles.ADMIN, EUserProjectRoles.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug?.toString() ?? "",
    projectId?.toString() ?? ""
  );

  return (
    <>
      <CreateUpdateWorkMapModal
        isOpen={creating}
        onClose={() => setCreating(false)}
        projectId={projectId?.toString() ?? ""}
        workspaceSlug={workspaceSlug?.toString() ?? ""}
      />
      <Header>
        <Header.LeftItem>
          <Breadcrumbs>
            <CommonProjectBreadcrumbs workspaceSlug={workspaceSlug?.toString()} projectId={projectId?.toString()} />
            <Breadcrumbs.Item
              isLast
              component={
                <BreadcrumbLink
                  isLast
                  label={t("sidebar.work_maps")}
                  href={`/${workspaceSlug}/projects/${projectId}/work-maps`}
                  icon={<WorkMapIcon className="size-4 text-tertiary" />}
                />
              }
            />
          </Breadcrumbs>
        </Header.LeftItem>
        {canCreate && (
          <Header.RightItem>
            <Button variant="primary" size="lg" onClick={() => setCreating(true)}>
              Add Work map
            </Button>
          </Header.RightItem>
        )}
      </Header>
    </>
  );
});
