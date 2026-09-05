/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  ISearchIssueResponse,
  TWorkMap,
  TWorkMapHydration,
  TWorkMapOpenAction,
  TWorkMapScene,
  TWorkMapSource,
  TWorkMapSourceKind,
} from "@plane/types";
import { APIService } from "@/services/api.service";

type TWorkMapPasteFile = { file_id: string; asset_id: string };

export class WorkMapService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private path(workspaceSlug: string, projectId: string, suffix = "") {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/work-maps/${suffix}`;
  }

  async fetchAll(workspaceSlug: string, projectId: string): Promise<TWorkMap[]> {
    return this.get(this.path(workspaceSlug, projectId)).then(({ data }) => data);
  }

  async fetchById(workspaceSlug: string, projectId: string, workMapId: string): Promise<TWorkMap> {
    return this.get(this.path(workspaceSlug, projectId, `${workMapId}/`)).then(({ data }) => data);
  }

  async create(workspaceSlug: string, projectId: string, data: Pick<TWorkMap, "name" | "access">): Promise<TWorkMap> {
    return this.post(this.path(workspaceSlug, projectId), data).then(({ data: response }) => response);
  }

  async fetchScene(workspaceSlug: string, projectId: string, workMapId: string): Promise<TWorkMapScene> {
    return this.get(this.path(workspaceSlug, projectId, `${workMapId}/scene/`)).then(({ data }) => data);
  }

  async duplicate(workspaceSlug: string, projectId: string, workMapId: string): Promise<TWorkMap> {
    return this.post(
      this.path(workspaceSlug, projectId, `${workMapId}/duplicate/`),
      {},
      {
        headers: { "Idempotency-Key": crypto.randomUUID() },
      }
    ).then(({ data }) => data);
  }

  async update(
    workspaceSlug: string,
    projectId: string,
    workMapId: string,
    data: Partial<Pick<TWorkMap, "name" | "access">>
  ): Promise<TWorkMap> {
    return this.patch(this.path(workspaceSlug, projectId, `${workMapId}/`), data).then(
      ({ data: response }) => response
    );
  }

  async setLocked(workspaceSlug: string, projectId: string, workMapId: string, locked: boolean): Promise<void> {
    const path = this.path(workspaceSlug, projectId, `${workMapId}/lock/`);
    await (locked ? this.post(path) : this.delete(path));
  }

  async setArchived(workspaceSlug: string, projectId: string, workMapId: string, archived: boolean): Promise<void> {
    const path = this.path(workspaceSlug, projectId, `${workMapId}/archive/`);
    await (archived ? this.post(path) : this.delete(path));
  }

  async setFavorite(workspaceSlug: string, projectId: string, workMapId: string, favorite: boolean): Promise<void> {
    const path = `/api/workspaces/${workspaceSlug}/projects/${projectId}/favorite-work-maps/${workMapId}/`;
    await (favorite ? this.post(path) : this.delete(path));
  }

  async deleteWorkMap(workspaceSlug: string, projectId: string, workMapId: string): Promise<void> {
    await this.delete(this.path(workspaceSlug, projectId, `${workMapId}/`));
  }

  async saveScene(
    workspaceSlug: string,
    projectId: string,
    workMapId: string,
    scene: Pick<TWorkMapScene, "collaboration_epoch" | "generation" | "scene_binary">
  ): Promise<Pick<TWorkMapScene, "generation">> {
    return this.patch(this.path(workspaceSlug, projectId, `${workMapId}/scene/`), scene).then(({ data }) => data);
  }

  async bindSource(
    workspaceSlug: string,
    projectId: string,
    workMapId: string,
    generation: number,
    placementId: string,
    source: Pick<TWorkMapSource, "source_kind" | "source_id">
  ): Promise<{ placement_id: string; node_key: string; revision: number; generation: number }> {
    return this.post(this.path(workspaceSlug, projectId, `${workMapId}/bindings/`), {
      generation,
      placement_id: placementId,
      ...source,
    }).then(({ data }) => data);
  }

  async hydrate(
    workspaceSlug: string,
    projectId: string,
    workMapId: string,
    nodeKeys: string[]
  ): Promise<TWorkMapHydration[]> {
    return this.post(this.path(workspaceSlug, projectId, `${workMapId}/bindings/hydrate/`), {
      node_keys: nodeKeys,
    }).then(({ data }) => data.results);
  }

  async openSource(
    workspaceSlug: string,
    projectId: string,
    workMapId: string,
    nodeKey: string
  ): Promise<TWorkMapOpenAction> {
    return this.post(this.path(workspaceSlug, projectId, `${workMapId}/bindings/open/`), {
      node_key: nodeKey,
    }).then(({ data }) => data);
  }

  async rebindPaste(
    workspaceSlug: string,
    projectId: string,
    workMapId: string,
    generation: number,
    nodeKeys: string[],
    files: TWorkMapPasteFile[] = []
  ): Promise<{ generation: number; node_keys: Record<string, string>; files: Record<string, string> }> {
    return this.post(this.path(workspaceSlug, projectId, `${workMapId}/paste-rebindings/`), {
      generation,
      idempotency_key: crypto.randomUUID(),
      node_keys: nodeKeys,
      files,
    }).then(({ data }) => data);
  }

  async searchSources(
    workspaceSlug: string,
    projectId: string,
    workMapId: string,
    sourceKind: TWorkMapSourceKind,
    query: string,
    sourceProjectId?: string
  ): Promise<TWorkMapSource[]> {
    return this.get(this.path(workspaceSlug, projectId, `${workMapId}/sources/`), {
      params: { source_kind: sourceKind, query, ...(sourceProjectId ? { project_id: sourceProjectId } : {}) },
    }).then(({ data }) => data.results);
  }

  async searchWorkItems(
    workspaceSlug: string,
    projectId: string,
    workMapId: string,
    query: string
  ): Promise<ISearchIssueResponse[]> {
    return this.get(this.path(workspaceSlug, projectId, `${workMapId}/sources/`), {
      params: { source_kind: "work-item", result_format: "issue-search", query },
    }).then(({ data }) => data.results);
  }
}
