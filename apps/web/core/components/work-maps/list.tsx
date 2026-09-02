/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import Link from "next/link";
import { Map } from "lucide-react";
import { useWorkMap } from "@/hooks/store/use-work-map";

type Props = { workspaceSlug: string; projectId: string };

export const WorkMapList = observer(function WorkMapList({ workspaceSlug, projectId }: Props) {
  const { maps } = useWorkMap();
  const workMaps = Object.values(maps);

  if (workMaps.length === 0)
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <Map className="mx-auto size-8 text-tertiary" />
          <h2 className="mt-3 text-16 font-semibold">No Work Maps yet</h2>
          <p className="mt-1 text-13 text-secondary">Create a spatial document for work, drawings, and web embeds.</p>
        </div>
      </div>
    );

  return (
    <div className="grid grid-cols-1 gap-3 p-6 md:grid-cols-2 xl:grid-cols-3">
      {workMaps.map((workMap) => (
        <Link
          key={workMap.id}
          href={`/${workspaceSlug}/projects/${projectId}/work-maps/${workMap.id}`}
          className="rounded-lg border border-subtle bg-surface-1 p-4 hover:bg-layer-1"
        >
          <div className="flex items-center gap-2">
            <Map className="size-4 text-secondary" />
            <h3 className="truncate text-14 font-medium">{workMap.name || "Untitled work map"}</h3>
          </div>
          <p className="mt-3 text-11 text-tertiary">Updated {new Date(workMap.updated_at).toLocaleDateString()}</p>
        </Link>
      ))}
    </div>
  );
});
