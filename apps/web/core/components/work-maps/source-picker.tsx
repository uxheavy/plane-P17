/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { TWorkMapSource, TWorkMapSourceKind } from "@plane/types";
import { useTranslation } from "@plane/i18n";
import { WorkMapService } from "@/services/work-map.service";

export const WORK_MAP_SOURCE_KINDS: TWorkMapSourceKind[] = [
  "work-item",
  "cycle",
  "module",
  "project-view",
  "page",
  "intake-item",
];

const SOURCE_KIND_LABEL_KEYS: Record<TWorkMapSourceKind, string> = {
  "work-item": "work_items",
  cycle: "cycles",
  module: "modules",
  "project-view": "views",
  page: "pages",
  "intake-item": "intake",
};

const service = new WorkMapService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  workMapId: string;
  initialSourceKind: TWorkMapSourceKind;
  onSelect: (source: TWorkMapSource) => void;
  onClose: () => void;
};

export function WorkMapSourcePicker({
  workspaceSlug,
  projectId,
  workMapId,
  initialSourceKind,
  onSelect,
  onClose,
}: Props) {
  const [sourceKind, setSourceKind] = useState<TWorkMapSourceKind>(initialSourceKind);
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [results, setResults] = useState<TWorkMapSource[]>([]);
  const [projects, setProjects] = useState<[string, string][]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    searchRef.current?.focus();
  }, [initialSourceKind]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      service
        .searchSources(workspaceSlug, projectId, workMapId, sourceKind, query.trim(), projectFilter || undefined)
        .then((sources) => {
          if (!cancelled) {
            setResults(sources);
            if (!projectFilter) {
              const projectOptions = [
                ...new Map(sources.map((source) => [source.project_id, source.project_name])).entries(),
              ];
              projectOptions.sort(([, first], [, second]) => first.localeCompare(second));
              setProjects(projectOptions);
            }
          }
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
  }, [workspaceSlug, projectId, workMapId, sourceKind, query, projectFilter]);

  const groupedResults = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; sources: TWorkMapSource[] }>();
    for (const source of results) {
      const group = groups.get(source.project_id) ?? {
        id: source.project_id,
        name: source.project_name,
        sources: [],
      };
      group.sources.push(source);
      groups.set(source.project_id, group);
    }
    return [...groups.values()];
  }, [results]);

  return (
    <div
      role="dialog"
      aria-label={t("add")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      className="absolute top-16 left-1/2 z-20 w-80 -translate-x-1/2 rounded-lg border border-subtle bg-surface-1 p-3 shadow-raised-200"
    >
      <div className="flex gap-2">
        <select
          aria-label={t("add")}
          className="rounded border border-subtle bg-surface-2 px-2 text-12"
          value={sourceKind}
          onChange={(event) => {
            setSourceKind(event.target.value as TWorkMapSourceKind);
            setProjectFilter("");
            setProjects([]);
          }}
        >
          {WORK_MAP_SOURCE_KINDS.filter((kind) => kind !== "work-item").map((kind) => (
            <option key={kind} value={kind}>
              {t(SOURCE_KIND_LABEL_KEYS[kind])}
            </option>
          ))}
        </select>
        <label htmlFor="work-map-source-search" className="sr-only">
          {t("search")}
        </label>
        <input
          ref={searchRef}
          id="work-map-source-search"
          data-testid="work-map-source-search"
          className="min-w-0 flex-1 rounded border border-subtle bg-surface-2 px-2 py-1.5 text-13"
          placeholder={t("search")}
          value={query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            if (!nextQuery.trim()) setResults([]);
          }}
        />
        <button type="button" className="text-12 text-secondary" onClick={onClose}>
          {t("close")}
        </button>
      </div>
      <select
        aria-label={t("common.projects")}
        className="mt-2 w-full rounded border border-subtle bg-surface-2 px-2 py-1.5 text-12"
        value={projectFilter}
        onChange={(event) => setProjectFilter(event.target.value)}
      >
        <option value="">{t("show_all")}</option>
        {projects.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      <div className="mt-2 max-h-72 overflow-y-auto">
        {groupedResults.map((group) => (
          <section key={group.id} aria-label={group.name}>
            <h3 className="px-2 py-1 text-11 font-medium text-secondary">{group.name}</h3>
            {group.sources.map((source) => (
              <button
                key={`${source.project_id}:${source.source_kind}:${source.source_id}`}
                type="button"
                className="block w-full rounded px-2 py-2 text-left hover:bg-layer-1"
                onClick={() => onSelect(source)}
              >
                <span className="block truncate text-13 text-primary">{source.name}</span>
                <span className="text-11 text-secondary">{t(SOURCE_KIND_LABEL_KEYS[source.source_kind])}</span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
