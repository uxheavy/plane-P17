/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import type { TWorkMapSource, TWorkMapSourceKind } from "@plane/types";
import { WorkMapService } from "@/services/work-map.service";

const sourceKinds: TWorkMapSourceKind[] = ["work-item", "cycle", "module", "project-view", "page", "intake-item"];
const service = new WorkMapService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  workMapId: string;
  onSelect: (source: TWorkMapSource) => void;
  onClose: () => void;
};

export function WorkMapSourcePicker({ workspaceSlug, projectId, workMapId, onSelect, onClose }: Props) {
  const [sourceKind, setSourceKind] = useState<TWorkMapSourceKind>("work-item");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TWorkMapSource[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      service
        .searchSources(workspaceSlug, projectId, workMapId, sourceKind, query.trim())
        .then((sources) => {
          if (!cancelled) setResults(sources);
          return undefined;
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [workspaceSlug, projectId, workMapId, sourceKind, query]);

  return (
    <div className="absolute top-14 left-3 z-20 w-80 rounded-lg border border-subtle bg-surface-1 p-3 shadow-raised-200">
      <div className="flex gap-2">
        <select
          aria-label="Source type"
          className="rounded border border-subtle bg-surface-2 px-2 text-12"
          value={sourceKind}
          onChange={(event) => setSourceKind(event.target.value as TWorkMapSourceKind)}
        >
          {sourceKinds.map((kind) => (
            <option key={kind} value={kind}>
              {kind.replace("-", " ")}
            </option>
          ))}
        </select>
        <input
          data-testid="work-map-source-search"
          className="min-w-0 flex-1 rounded border border-subtle bg-surface-2 px-2 py-1.5 text-13"
          placeholder="Search accessible sources"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="text-12 text-secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="mt-2 max-h-72 overflow-y-auto">
        {results.map((source) => (
          <button
            key={`${source.source_kind}:${source.source_id}`}
            type="button"
            className="block w-full rounded px-2 py-2 text-left hover:bg-layer-1"
            onClick={() => onSelect(source)}
          >
            <span className="block truncate text-13 text-primary">{source.name}</span>
            <span className="text-11 text-secondary">{source.source_kind.replace("-", " ")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
