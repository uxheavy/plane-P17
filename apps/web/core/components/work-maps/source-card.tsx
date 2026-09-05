/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { INBOX_STATUS, MODULE_STATUS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { CycleIcon, IntakeIcon, ModuleIcon, PageIcon, ViewsIcon } from "@plane/propel/icons";
import type { TWorkMapHydration, TWorkMapSourceKind } from "@plane/types";
import { formatLocalizedDateOnly } from "@plane/utils";
import { InboxStatusIcon } from "@/components/inbox/inbox-status-icon";
import { WorkItemPreviewCard } from "@/components/issues/preview-card";
import { ModuleProgressSummary } from "@/components/modules/module-progress-summary";

type Props = {
  projection: TWorkMapHydration | undefined;
};

const SOURCE_KIND_LABELS: Record<Exclude<TWorkMapSourceKind, "work-item">, string> = {
  cycle: "cycles",
  module: "modules",
  "project-view": "views",
  page: "pages",
  "intake-item": "intake",
};

const SOURCE_KIND_ICONS = {
  cycle: CycleIcon,
  module: ModuleIcon,
  "project-view": ViewsIcon,
  page: PageIcon,
  "intake-item": IntakeIcon,
};

export function WorkMapSourceCard({ projection }: Props) {
  const { currentLocale, t } = useTranslation();
  if (!projection)
    return (
      <div
        data-testid="work-map-source-loading"
        data-state="loading"
        className="grid size-full place-items-center rounded-lg bg-surface-1 text-13 text-tertiary"
      >
        {t("common.loading")}…
      </div>
    );

  if (!projection.available)
    return (
      <div
        data-testid="work-map-source-unavailable"
        className="grid size-full place-items-center rounded-lg border border-dashed border-subtle bg-surface-1 text-13 text-secondary"
      >
        {t("common.work_map.source_unavailable")}
      </div>
    );

  const { source } = projection;
  if (source.source_kind === "work-item")
    return (
      <div className="size-full text-left" data-status={source.state?.group ?? "not-set"}>
        <WorkItemPreviewCard
          className="size-full w-full overflow-hidden shadow-none"
          projectId={source.project_id}
          stateDetails={source.state ?? {}}
          workItem={{
            id: source.source_id,
            name: source.name,
            sequence_id: source.sequence_id,
            priority: source.priority,
            start_date: source.start_date,
            target_date: source.target_date,
            type_id: source.type_id,
          }}
        />
      </div>
    );

  if (source.source_kind === "intake-item") {
    const status = INBOX_STATUS.find((item) => item.status === source.intake_status);
    return (
      <div className="relative size-full text-left" data-status={source.intake_status}>
        <WorkItemPreviewCard
          className="size-full w-full overflow-hidden shadow-none"
          projectId={source.project_id}
          stateDetails={source.state ?? {}}
          workItem={{
            id: source.source_id,
            name: source.name,
            sequence_id: source.sequence_id,
            priority: source.priority,
            start_date: source.start_date,
            target_date: source.target_date,
            type_id: source.type_id,
          }}
        />
        {status && source.intake_status !== undefined && (
          <span className="absolute top-3 right-3 flex items-center gap-1 rounded-sm bg-surface-1 px-1 text-11 font-medium text-secondary">
            <InboxStatusIcon type={status.status} size={12} />
            {t(status.i18n_title)}
          </span>
        )}
      </div>
    );
  }

  if (source.source_kind === "cycle")
    return (
      <div className="flex size-full flex-col gap-2 rounded-lg border border-subtle bg-surface-1 p-3 text-left shadow-raised-100">
        <span className="flex items-center gap-1.5 text-11 font-medium text-secondary">
          <CycleIcon className="size-3.5" />
          {t(SOURCE_KIND_LABELS[source.source_kind])}
        </span>
        <strong className="line-clamp-3 text-14 font-medium text-primary">{source.name}</strong>
        <div className="mt-auto flex flex-col gap-1 text-11 text-secondary">
          <span>{source.project_name}</span>
          {(source.start_date || source.end_date) && (
            <span>
              {formatLocalizedDateOnly(source.start_date, currentLocale) ?? "…"} →{" "}
              {formatLocalizedDateOnly(source.end_date, currentLocale) ?? "…"}
            </span>
          )}
        </div>
      </div>
    );

  if (source.source_kind === "module") {
    const status = MODULE_STATUS.find((item) => item.value === source.status);
    return (
      <div
        className="flex size-full flex-col gap-2 rounded-lg border border-subtle bg-surface-1 p-3 text-left shadow-raised-100"
        data-status={source.status}
      >
        <div className="flex items-center justify-between gap-2 text-11 text-secondary">
          <span className="flex items-center gap-1.5 font-medium">
            <ModuleIcon className="size-3.5" />
            {t(SOURCE_KIND_LABELS[source.source_kind])}
          </span>
          {status && <span style={{ color: status.color }}>{t(status.i18n_label)}</span>}
        </div>
        <strong className="line-clamp-3 text-14 font-medium text-primary">{source.name}</strong>
        <ModuleProgressSummary
          backlog_issues={source.backlog_issues}
          unstarted_issues={source.unstarted_issues}
          started_issues={source.started_issues}
          completed_issues={source.completed_issues}
          cancelled_issues={source.cancelled_issues}
        />
        <div className="mt-auto flex flex-col gap-1 text-11 text-secondary">
          <span>{source.project_name}</span>
          {(source.start_date || source.target_date) && (
            <span>
              {formatLocalizedDateOnly(source.start_date, currentLocale) ?? "…"} →{" "}
              {formatLocalizedDateOnly(source.target_date, currentLocale) ?? "…"}
            </span>
          )}
        </div>
      </div>
    );
  }

  const SourceIcon = SOURCE_KIND_ICONS[source.source_kind];
  return (
    <div className="relative flex size-full flex-col justify-between rounded-lg border border-subtle bg-surface-1 p-3 text-left shadow-raised-100">
      <span className="flex items-center gap-1.5 text-11 font-medium text-secondary">
        <SourceIcon className="size-3.5" />
        {t(SOURCE_KIND_LABELS[source.source_kind])}
      </span>
      <strong className="line-clamp-3 text-14 font-medium text-primary">{source.name}</strong>
      <span className="text-11 text-secondary">{source.project_name}</span>
    </div>
  );
}
