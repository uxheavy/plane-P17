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
  TWorkMap,
  TWorkMapHydration,
  TWorkMapOpenAction,
  TWorkMapScene,
  TWorkMapSource,
  TWorkMapSourceKind,
} from "@plane/types";
import { APIService } from "@/services/api.service";

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
    return this.post(this.path(workspaceSlug, projectId, `${workMapId}/duplicate/`)).then(({ data }) => data);
  }

  async saveScene(
    workspaceSlug: string,
    projectId: string,
    workMapId: string,
    scene: TWorkMapScene
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
    nodeKeys: string[]
  ): Promise<{ generation: number; node_keys: Record<string, string> }> {
    return this.post(this.path(workspaceSlug, projectId, `${workMapId}/paste-rebindings/`), {
      generation,
      idempotency_key: crypto.randomUUID(),
      node_keys: nodeKeys,
      files: [],
    }).then(({ data }) => data);
  }

  async searchSources(
    workspaceSlug: string,
    projectId: string,
    workMapId: string,
    sourceKind: TWorkMapSourceKind,
    query: string,
    sourceProjectId?: string,
  ): Promise<TWorkMapSource[]> {
    return this.get(this.path(workspaceSlug, projectId, `${workMapId}/sources/`), {
      params: { source_kind: sourceKind, query, ...(sourceProjectId ? { project_id: sourceProjectId } : {}) },
    }).then(({ data }) => data.results);
  }
}
