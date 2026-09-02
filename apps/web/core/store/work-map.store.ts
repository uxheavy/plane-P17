/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { makeObservable, observable, action, runInAction } from "mobx";
import type { TWorkMap, TWorkMapHydration } from "@plane/types";
import { WorkMapService } from "@/services/work-map.service";

const HYDRATION_CONCURRENCY = 8;

export interface IWorkMapStore {
  maps: Record<string, TWorkMap>;
  projections: Record<string, TWorkMapHydration>;
  fetchAll: (workspaceSlug: string, projectId: string) => Promise<TWorkMap[]>;
  fetchById: (workspaceSlug: string, projectId: string, workMapId: string) => Promise<TWorkMap>;
  create: (workspaceSlug: string, projectId: string, name: string) => Promise<TWorkMap>;
  hydrate: (workspaceSlug: string, projectId: string, workMapId: string, nodeKeys: string[]) => Promise<void>;
  invalidate: (nodeKeys: string[]) => void;
}

export class WorkMapStore implements IWorkMapStore {
  maps: Record<string, TWorkMap> = {};
  projections: Record<string, TWorkMapHydration> = {};
  service = new WorkMapService();
  private hydrationRequestRevision: Record<string, number> = {};

  constructor() {
    makeObservable(this, {
      maps: observable,
      projections: observable,
      fetchAll: action,
      fetchById: action,
      create: action,
      hydrate: action,
      invalidate: action,
    });
  }

  fetchAll = async (workspaceSlug: string, projectId: string) => {
    const maps = await this.service.fetchAll(workspaceSlug, projectId);
    runInAction(() => maps.forEach((map) => (this.maps[map.id] = map)));
    return maps;
  };

  fetchById = async (workspaceSlug: string, projectId: string, workMapId: string) => {
    const map = await this.service.fetchById(workspaceSlug, projectId, workMapId);
    runInAction(() => (this.maps[map.id] = map));
    return map;
  };

  create = async (workspaceSlug: string, projectId: string, name: string) => {
    const map = await this.service.create(workspaceSlug, projectId, { name, access: 0 });
    runInAction(() => (this.maps[map.id] = map));
    return map;
  };

  hydrate = async (workspaceSlug: string, projectId: string, workMapId: string, nodeKeys: string[]) => {
    if (nodeKeys.length === 0) return;
    const queue = [...new Set(nodeKeys)].slice(0, 100);
    const requestRevisions = new Map(
      queue.map((nodeKey) => {
        const revision = (this.hydrationRequestRevision[nodeKey] ?? 0) + 1;
        this.hydrationRequestRevision[nodeKey] = revision;
        return [nodeKey, revision];
      })
    );
    let nextIndex = 0;
    const hydrateNext = async (): Promise<void> => {
      const index = nextIndex;
      nextIndex += 1;
      const nodeKey = queue[index];
      if (!nodeKey) return;
      let projection: TWorkMapHydration = { node_key: nodeKey, available: false };
      try {
        const [result] = await this.service.hydrate(workspaceSlug, projectId, workMapId, [nodeKey]);
        if (result?.node_key === nodeKey) projection = result;
      } catch {
        // A transport or resolver failure is fail-closed for this opaque key only.
      }
      runInAction(() => {
        if (this.hydrationRequestRevision[nodeKey] === requestRevisions.get(nodeKey))
          this.projections[nodeKey] = projection;
      });
      await hydrateNext();
    };
    await Promise.all(Array.from({ length: Math.min(HYDRATION_CONCURRENCY, queue.length) }, () => hydrateNext()));
  };

  invalidate = (nodeKeys: string[]) => {
    nodeKeys.forEach((nodeKey) => {
      this.hydrationRequestRevision[nodeKey] = (this.hydrationRequestRevision[nodeKey] ?? 0) + 1;
      this.projections[nodeKey] = { node_key: nodeKey, available: false };
    });
  };
}
