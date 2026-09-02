/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TWorkMapHydration } from "@plane/types";
import { WorkItemPreviewCard } from "@/components/issues/preview-card";

type Props = {
  projection: TWorkMapHydration | undefined;
  onOpen: () => void;
};

export function WorkMapSourceCard({ projection, onOpen }: Props) {
  if (!projection)
    return (
      <div
        data-testid="work-map-source-loading"
        data-state="loading"
        className="grid size-full place-items-center rounded-lg bg-surface-1 text-13 text-tertiary"
      >
        Loading…
      </div>
    );

  if (!projection.available)
    return (
      <div
        data-testid="work-map-source-unavailable"
        className="grid size-full place-items-center rounded-lg border border-dashed border-subtle bg-surface-1 text-13 text-secondary"
      >
        Source unavailable
      </div>
    );

  const { source } = projection;
  if (source.source_kind === "work-item")
    return (
      <div className="relative size-full text-left">
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
        <button
          type="button"
          className="absolute top-2 right-2 rounded bg-surface-1 px-2 py-1 text-11 shadow-raised-100"
          onClick={onOpen}
        >
          Open
        </button>
      </div>
    );

  return (
    <div className="relative flex size-full flex-col justify-between rounded-lg border border-subtle bg-surface-1 p-3 text-left shadow-raised-100">
      <span className="text-11 font-medium text-secondary">{source.source_kind.replace("-", " ")}</span>
      <strong className="line-clamp-3 text-14 font-medium text-primary">{source.name}</strong>
      <button type="button" className="self-start text-11 text-accent-primary" onClick={onOpen}>
        Open
      </button>
    </div>
  );
}
