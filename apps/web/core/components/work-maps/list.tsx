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
import Link from "next/link";
import { Map } from "lucide-react";
import useSWR from "swr";
import { CopyIcon } from "@plane/propel/icons";
import type { TWorkMap } from "@plane/types";
import { CustomMenu } from "@plane/ui";
import { useAppRouter } from "@/hooks/use-app-router";
import { useWorkMap } from "@/hooks/store/use-work-map";
import { WorkMapService } from "@/services/work-map.service";

const updatedAtFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC" });
const service = new WorkMapService();

type Props = { workspaceSlug: string; projectId: string };

export const WorkMapList = observer(function WorkMapList({ workspaceSlug, projectId }: Props) {
  const router = useAppRouter();
  const store = useWorkMap();
  const { data: workMaps = [] } = useSWR<TWorkMap[]>(`PROJECT_WORK_MAPS_${projectId}`, () =>
    store.fetchAll(workspaceSlug, projectId)
  );

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
        <div key={workMap.id} className="relative rounded-lg border border-subtle bg-surface-1 hover:bg-layer-1">
          <Link href={`/${workspaceSlug}/projects/${projectId}/work-maps/${workMap.id}`} className="block p-4 pr-12">
            <div className="flex items-center gap-2">
              <Map className="size-4 text-secondary" />
              <h3 className="truncate text-14 font-medium">{workMap.name || "Untitled work map"}</h3>
            </div>
            <p className="mt-3 text-11 text-tertiary">
              Updated {updatedAtFormatter.format(new Date(workMap.updated_at))}
            </p>
          </Link>
          <div className="absolute top-3 right-3">
            <CustomMenu ellipsis placement="bottom-end" closeOnSelect>
              <CustomMenu.MenuItem
                onClick={async () => {
                  const duplicate = await service.duplicate(workspaceSlug, projectId, workMap.id);
                  router.push(`/${workspaceSlug}/projects/${projectId}/work-maps/${duplicate.id}`);
                }}
                className="flex items-center gap-2"
              >
                <CopyIcon className="size-3" />
                Make a copy
              </CustomMenu.MenuItem>
            </CustomMenu>
          </div>
        </div>
      ))}
    </div>
  );
});
