/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { TIssue } from "./issues/issue";
import type { TStateGroups } from "./state";
import type { TFileSignedURLResponse } from "./file";

export type TWorkMapSourceKind = "work-item" | "cycle" | "module" | "project-view" | "page" | "intake-item";

export type TWorkMap = {
  id: string;
  name: string;
  owned_by: string;
  access: 0 | 1;
  archived_at: string | null;
  collaboration_epoch: number;
  is_favorite: boolean;
  is_locked: boolean;
  sort_order: number;
  generation: number;
  created_at: string;
  updated_at: string;
};

export type TWorkMapScene = {
  collaboration_epoch: number;
  generation: number;
  scene_binary: string;
};

export type TWorkMapFile = {
  assetId: string;
  mimeType:
    | "image/svg+xml"
    | "image/png"
    | "image/jpeg"
    | "image/gif"
    | "image/webp"
    | "image/bmp"
    | "image/x-icon"
    | "image/avif"
    | "image/jfif";
  created: number;
};

export type TWorkMapFiles = Record<string, TWorkMapFile>;

export type TWorkMapSceneAsset = {
  asset_id: string;
  name: string;
  mime_type: string;
  size: number;
  asset_url: string;
  is_uploaded: boolean;
};

export type TWorkMapSceneAssetUploadResponse = {
  asset: TWorkMapSceneAsset;
  upload_data: TFileSignedURLResponse["upload_data"];
};

type TWorkMapSourceBase = {
  source_kind: TWorkMapSourceKind;
  source_id: string;
  project_id: string;
  project_name: string;
  name: string;
};

export type TWorkMapSource =
  | (TWorkMapSourceBase & {
      source_kind: "work-item" | "intake-item";
      sequence_id: number;
      priority: TIssue["priority"];
      start_date: string | null;
      target_date: string | null;
      type_id: string | null;
      state: { id?: string; name?: string; group?: TStateGroups } | null;
      intake_status?: number;
    })
  | (TWorkMapSourceBase & { source_kind: "cycle"; start_date: string | null; end_date: string | null })
  | (TWorkMapSourceBase & {
      source_kind: "module";
      status: string;
      start_date: string | null;
      target_date: string | null;
      backlog_issues: number;
      unstarted_issues: number;
      started_issues: number;
      completed_issues: number;
      cancelled_issues: number;
    })
  | (TWorkMapSourceBase & { source_kind: "project-view" | "page" });

export type TWorkMapHydration =
  | { node_key: string; available: false }
  | { node_key: string; available: true; revision: number; source: TWorkMapSource };

export type TWorkMapOpenAction =
  | { node_key: string; available: false }
  | {
      node_key: string;
      available: true;
      action: {
        source_kind: TWorkMapSourceKind;
        source_id: string;
        project_id: string;
      };
    };
