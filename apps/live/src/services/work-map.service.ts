/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { z } from "zod";
import { APIService } from "@/services/api.service";

export const workMapProfileSchema = z
  .object({
    display_name: z.string(),
    avatar_url: z.string().nullable(),
  })
  .strict();

export const workMapAuthorizationSchema = z.object({
  document_type: z.literal("work_map"),
  workspace_slug: z.string(),
  project_id: z.string().uuid(),
  work_map_id: z.string().uuid(),
  sender_id: z.string().uuid(),
  profile: workMapProfileSchema,
  generation: z.number().int().nonnegative(),
  collaboration_epoch: z.number().int().nonnegative(),
  readable: z.literal(true),
  editable: z.boolean(),
  is_locked: z.boolean(),
  archived_at: z.string().nullable(),
});

export type WorkMapAuthorization = z.infer<typeof workMapAuthorizationSchema>;

export class WorkMapService extends APIService {
  async authorize(
    workspaceSlug: string,
    projectId: string,
    workMapId: string,
    cookie: string
  ): Promise<WorkMapAuthorization> {
    const response = await this.get(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${projectId}/work-maps/${workMapId}/realtime/`,
      { headers: { Cookie: cookie } }
    );
    return workMapAuthorizationSchema.parse(response.data);
  }
}
