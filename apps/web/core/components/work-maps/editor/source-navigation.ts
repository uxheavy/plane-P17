/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TWorkMapSourceKind } from "@plane/types";

type TSource = { source_kind: TWorkMapSourceKind; source_id: string; project_id: string };

export const getSourcePath = (workspaceSlug: string, source: TSource) => {
  const projectPath = `/${workspaceSlug}/projects/${source.project_id}`;
  switch (source.source_kind) {
    case "work-item":
      return `${projectPath}/issues/${source.source_id}`;
    case "cycle":
      return `${projectPath}/cycles/${source.source_id}`;
    case "module":
      return `${projectPath}/modules/${source.source_id}`;
    case "project-view":
      return `${projectPath}/views/${source.source_id}`;
    case "page":
      return `${projectPath}/pages/${source.source_id}`;
    case "intake-item":
      return `${projectPath}/intake?inboxIssueId=${source.source_id}`;
  }
};
