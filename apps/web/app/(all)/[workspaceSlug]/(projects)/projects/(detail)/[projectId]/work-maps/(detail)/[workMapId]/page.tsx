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
import useSWR from "swr";
import { PageHead } from "@/components/core/page-title";
import { WorkMapEditor } from "@/components/work-maps/editor";
import { useWorkMap } from "@/hooks/store/use-work-map";
import type { Route } from "./+types/page";

function ProjectWorkMapPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId, workMapId } = params;
  const store = useWorkMap();
  const { error } = useSWR(`PROJECT_WORK_MAP_${workMapId}`, () => store.fetchById(workspaceSlug, projectId, workMapId));
  const workMap = store.maps[workMapId];
  if (error) return <div className="grid size-full place-items-center text-14">Work Map not found</div>;
  if (!workMap)
    return <div className="grid size-full place-items-center text-13 text-secondary">Loading Work Map…</div>;
  return (
    <>
      <PageHead title={workMap.name || "Work Map"} />
      <WorkMapEditor key={workMap.id} workspaceSlug={workspaceSlug} projectId={projectId} workMap={workMap} />
    </>
  );
}

export default observer(ProjectWorkMapPage);
