/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRouter } from "next/navigation";
import { TreeMapIcon } from "@plane/propel/icons";
import type { TActivityEntityData, TWorkMapEntityData } from "@plane/types";
import { Avatar } from "@plane/ui";
import { calculateTimeAgo, getFileURL } from "@plane/utils";
import { ListItem } from "@/components/core/list";
import { useMember } from "@/hooks/store/use-member";

type BlockProps = {
  activity: TActivityEntityData;
  ref: React.RefObject<HTMLDivElement | null>;
  workspaceSlug: string;
};

export function RecentWorkMap(props: BlockProps) {
  const { activity, ref, workspaceSlug } = props;
  const router = useRouter();
  const { getUserDetails } = useMember();
  const workMap = activity.entity_data as TWorkMapEntityData;

  if (!workMap) return null;

  const owner = getUserDetails(workMap.owned_by);
  const workMapLink = `/${workspaceSlug}/projects/${workMap.project_id}/work-maps/${workMap.id}`;

  return (
    <ListItem
      key={activity.id}
      itemLink={workMapLink}
      title={workMap.name}
      prependTitleElement={
        <div className="flex flex-shrink-0 items-center gap-2">
          <div className="grid size-8 flex-shrink-0 place-items-center rounded-sm bg-layer-2">
            <TreeMapIcon className="size-4 text-tertiary" />
          </div>
          <div className="text-13 font-medium whitespace-nowrap text-placeholder">{workMap.project_identifier}</div>
        </div>
      }
      appendTitleElement={
        <div className="flex-shrink-0 text-11 font-medium text-placeholder">
          {calculateTimeAgo(activity.visited_at)}
        </div>
      }
      quickActionElement={
        <div className="flex gap-4">
          <Avatar src={getFileURL(owner?.avatar_url ?? "")} name={owner?.display_name} />
        </div>
      }
      parentRef={ref}
      disableLink={false}
      className="my-auto border-none !px-2 py-3"
      itemClassName="my-auto bg-layer-transparent"
      onItemClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        router.push(workMapLink);
      }}
    />
  );
}
