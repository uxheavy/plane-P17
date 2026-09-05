/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { ArrowDownWideNarrow, SlidersHorizontal } from "lucide-react";
import useSWR from "swr";
import { EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { getButtonStyling } from "@plane/propel/button";
import { CheckIcon, WorkMapIcon } from "@plane/propel/icons";
import type { TWorkMap } from "@plane/types";
import { EUserProjectRoles } from "@plane/types";
import { cn } from "@plane/utils";
import { CustomMenu } from "@plane/ui";
import { ListItem, ListLayout, ListSearchInput } from "@/components/core/list";
import { useWorkMap } from "@/hooks/store/use-work-map";
import { useUserPermissions } from "@/hooks/store/user";
import { useUser } from "@/hooks/store/user";
import { CreateUpdateWorkMapModal } from "./create-update-modal";
import { WorkMapListActions } from "./list-actions";

type Props = { workspaceSlug: string; projectId: string };
type Tab = "public" | "private" | "archived";
type Sort = "name" | "created_at" | "updated_at";
type LockFilter = "all" | "locked" | "unlocked";

const TABS: { key: Tab; label: string }[] = [
  { key: "public", label: "Public" },
  { key: "private", label: "Private" },
  { key: "archived", label: "Archived" },
];

const SORTS: { key: Sort; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "created_at", label: "Date created" },
  { key: "updated_at", label: "Date modified" },
];

export const WorkMapList = observer(function WorkMapList({ workspaceSlug, projectId }: Props) {
  const store = useWorkMap();
  const { t } = useTranslation();
  const { data: user } = useUser();
  const { allowPermissions } = useUserPermissions();
  const [tab, setTab] = useState<Tab>("public");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated_at");
  const [lockFilter, setLockFilter] = useState<LockFilter>("all");
  const { data: workMaps = [], mutate } = useSWR<TWorkMap[]>(`PROJECT_WORK_MAPS_${projectId}`, () =>
    store.fetchAll(workspaceSlug, projectId)
  );
  const canEdit = allowPermissions(
    [EUserProjectRoles.ADMIN, EUserProjectRoles.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );
  const isAdmin = allowPermissions([EUserProjectRoles.ADMIN], EUserPermissionsLevel.PROJECT, workspaceSlug, projectId);

  const filteredMaps = useMemo(
    () =>
      workMaps
        .filter((workMap) => {
          if (tab === "archived") return !!workMap.archived_at;
          if (workMap.archived_at) return false;
          return tab === "public" ? workMap.access === 0 : workMap.access === 1;
        })
        .filter((workMap) => lockFilter === "all" || workMap.is_locked === (lockFilter === "locked"))
        .filter((workMap) => workMap.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        .sort((left: TWorkMap, right: TWorkMap) => {
          if (sort === "name") return left.name.localeCompare(right.name);
          return Date.parse(right[sort]) - Date.parse(left[sort]);
        }),
    [lockFilter, query, sort, tab, workMaps]
  );

  if (workMaps.length === 0)
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <WorkMapIcon className="mx-auto size-8 text-tertiary" />
          <h2 className="mt-3 text-16 font-semibold">{t("common.work_map.empty_state.title")}</h2>
          <p className="mt-1 text-13 text-secondary">{t("common.work_map.empty_state.description")}</p>
        </div>
      </div>
    );

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-subtle px-page-x">
        <div className="relative flex h-full items-center">
          {TABS.map((item) => (
            <button key={item.key} type="button" className="flex h-full flex-col" onClick={() => setTab(item.key)}>
              <span
                className={cn("flex flex-1 items-center justify-center px-4 text-13 font-medium", {
                  "text-accent-primary": tab === item.key,
                })}
              >
                {item.label}
              </span>
              <span
                className={cn("w-full rounded-t border-t-2 border-transparent", {
                  "border-accent-strong": tab === item.key,
                })}
              />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <ListSearchInput placeholder="Search work maps" searchQuery={query} updateSearchQuery={setQuery} />
          <CustomMenu
            customButton={
              <div className={getButtonStyling("secondary", "lg")}>
                <ArrowDownWideNarrow className="size-3" />
                {SORTS.find((item) => item.key === sort)?.label}
              </div>
            }
            placement="bottom-end"
            closeOnSelect
          >
            {SORTS.map((item) => (
              <CustomMenu.MenuItem
                key={item.key}
                className="flex items-center justify-between gap-2"
                onClick={() => setSort(item.key)}
              >
                {item.label}
                {sort === item.key && <CheckIcon className="size-3" />}
              </CustomMenu.MenuItem>
            ))}
          </CustomMenu>
          <CustomMenu
            customButton={
              <div className={getButtonStyling("secondary", "lg")}>
                <SlidersHorizontal className="size-3" /> Filters
              </div>
            }
            placement="bottom-end"
            closeOnSelect
          >
            {(["all", "locked", "unlocked"] as const).map((value) => (
              <CustomMenu.MenuItem
                key={value}
                className="flex items-center justify-between gap-2 capitalize"
                onClick={() => setLockFilter(value)}
              >
                {value}
                {lockFilter === value && <CheckIcon className="size-3" />}
              </CustomMenu.MenuItem>
            ))}
          </CustomMenu>
        </div>
      </div>
      {filteredMaps.length === 0 ? (
        <div className="grid h-full place-items-center text-13 text-secondary">No matching Work maps</div>
      ) : (
        <ListLayout>
          {filteredMaps.map((workMap) => (
            <WorkMapListItem
              key={workMap.id}
              workMap={workMap}
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              canEdit={canEdit}
              canChangeAccess={workMap.owned_by === user?.id}
              canManage={isAdmin || workMap.owned_by === user?.id}
              refresh={mutate}
            />
          ))}
        </ListLayout>
      )}
    </div>
  );
});

type ItemProps = {
  canEdit: boolean;
  canManage: boolean;
  canChangeAccess: boolean;
  projectId: string;
  refresh: () => Promise<unknown>;
  workMap: TWorkMap;
  workspaceSlug: string;
};

function WorkMapListItem({
  canEdit,
  canManage,
  canChangeAccess,
  projectId,
  refresh,
  workMap,
  workspaceSlug,
}: ItemProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <CreateUpdateWorkMapModal
        canChangeAccess={canChangeAccess}
        isOpen={editing}
        onClose={() => setEditing(false)}
        onCompleted={refresh}
        projectId={projectId}
        workMap={workMap}
        workspaceSlug={workspaceSlug}
      />
      <ListItem
        parentRef={parentRef}
        itemLink={`/${workspaceSlug}/projects/${projectId}/work-maps/${workMap.id}`}
        prependTitleElement={<WorkMapIcon className="size-4 text-tertiary" />}
        title={`${workMap.name || "Untitled work map"}${workMap.is_locked ? " · locked" : ""}`}
        actionableItems={
          <WorkMapListActions
            canEdit={canEdit}
            canManage={canManage}
            canChangeAccess={canChangeAccess}
            onEdit={() => setEditing(true)}
            projectId={projectId}
            refresh={refresh}
            workMap={workMap}
            workspaceSlug={workspaceSlug}
          />
        }
      />
    </>
  );
}
