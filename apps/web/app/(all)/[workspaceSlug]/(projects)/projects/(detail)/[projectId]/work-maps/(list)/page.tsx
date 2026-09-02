/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
import { PageHead } from "@/components/core/page-title";
import { WorkMapList } from "@/components/work-maps/list";
import { useWorkMap } from "@/hooks/store/use-work-map";
import type { Route } from "./+types/page";

export default function ProjectWorkMapsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  const store = useWorkMap();
  useSWR(`PROJECT_WORK_MAPS_${projectId}`, () => store.fetchAll(workspaceSlug, projectId));
  return (
    <>
      <PageHead title="Work Maps" />
      <WorkMapList workspaceSlug={workspaceSlug} projectId={projectId} />
    </>
  );
}
