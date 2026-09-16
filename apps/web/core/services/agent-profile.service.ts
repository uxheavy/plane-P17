/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type TAgentProfileResponse = {
  label: string;
  description: string;
  model: string | null;
  revision: string;
  instructions: TAgentProfileInstructions;
  skills: TAgentProfileSkills;
};

export type TAgentProfileInstructions = {
  exists: boolean;
  content: string;
  truncated: boolean;
};

export type TAgentProfileEditableSkill = {
  name: string;
  description: string;
  category: string | null;
  editable: true;
  owner_id: string;
  skill_id: string;
  revision: string;
};

export type TAgentProfileReadonlySkill = {
  name: string;
  description: string;
  category: string | null;
  editable: false;
  item_id: string;
};

export type TAgentProfileSkill = TAgentProfileEditableSkill | TAgentProfileReadonlySkill;

export type TAgentProfileSkills = {
  items: TAgentProfileSkill[];
  truncated: boolean;
};

export type TAgentProfileUpdate = {
  description: string;
  expected_revision: string;
};

export type TAgentProfileUpdateResponse = {
  description: string;
  revision: string;
};

export type TAgentProfileModelResponse = {
  provider: string | null;
  model: string | null;
  revision: string;
};

export type TAgentProfileModelUpdate = {
  provider: string | null;
  model: string | null;
  expected_revision: string;
};

export type TAgentProfileSkillResponse = {
  owner_id: string;
  skill_id: string;
  revision: string;
  content: string;
};

export type TAgentProfileSkillEditResponse = {
  success: boolean;
  staged?: boolean;
  pending_id?: string;
  owner_id: string;
  skill_id: string;
  expected_revision?: string;
  content_revision?: string;
  revision?: string;
  stale?: boolean;
  error?: string;
};

export type TAgentProfilePendingSkill = {
  id: string;
  action: string;
  summary: string;
  origin: string;
  created_at: number;
  owner_id: string;
  skill_id: string;
  expected_revision: string;
  content_revision: string;
};

export type TAgentProfilePendingSkillsResponse =
  | { items: TAgentProfilePendingSkill[]; truncated: boolean }
  | { pending: TAgentProfilePendingSkill; review: { diff: string; truncated: boolean } };

export class AgentProfileService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private getProfilePath(workspaceSlug: string, userId: string) {
    return `/api/workspaces/${workspaceSlug}/agents/${userId}/profile/`;
  }

  async getAgentProfile(workspaceSlug: string, userId: string): Promise<TAgentProfileResponse> {
    return this.get(this.getProfilePath(workspaceSlug, userId)).then((response) => response?.data);
  }

  async updateAgentProfile(
    workspaceSlug: string,
    userId: string,
    data: TAgentProfileUpdate
  ): Promise<TAgentProfileUpdateResponse> {
    return this.patch(this.getProfilePath(workspaceSlug, userId), data).then((response) => response?.data);
  }

  async getAgentProfileModel(workspaceSlug: string, userId: string): Promise<TAgentProfileModelResponse> {
    return this.get(`${this.getProfilePath(workspaceSlug, userId)}model/`).then((response) => response?.data);
  }

  async updateAgentProfileModel(
    workspaceSlug: string,
    userId: string,
    data: TAgentProfileModelUpdate
  ): Promise<TAgentProfileModelResponse> {
    return this.patch(`${this.getProfilePath(workspaceSlug, userId)}model/`, data).then((response) => response?.data);
  }

  private getSkillPath(workspaceSlug: string, userId: string, ownerId: string, skillId: string) {
    const skillPath = skillId.split("/").map(encodeURIComponent).join("/");
    return `${this.getProfilePath(workspaceSlug, userId)}skills/${encodeURIComponent(ownerId)}/${skillPath}/`;
  }

  async getAgentProfileSkill(
    workspaceSlug: string,
    userId: string,
    ownerId: string,
    skillId: string,
    expectedRevision: string
  ): Promise<TAgentProfileSkillResponse> {
    const path = this.getSkillPath(workspaceSlug, userId, ownerId, skillId);
    return this.get(`${path}?expected_revision=${encodeURIComponent(expectedRevision)}`).then(
      (response) => response?.data
    );
  }

  async updateAgentProfileSkill(
    workspaceSlug: string,
    userId: string,
    ownerId: string,
    skillId: string,
    data: { content: string; expected_revision: string }
  ): Promise<TAgentProfileSkillEditResponse> {
    return this.patch(this.getSkillPath(workspaceSlug, userId, ownerId, skillId), data).then(
      (response) => response?.data
    );
  }

  async getAgentProfileSkillPending(
    workspaceSlug: string,
    userId: string,
    pendingId?: string
  ): Promise<TAgentProfilePendingSkillsResponse> {
    const query = pendingId ? `?pending_id=${encodeURIComponent(pendingId)}` : "";
    return this.get(`${this.getProfilePath(workspaceSlug, userId)}skills/pending/${query}`).then(
      (response) => response?.data
    );
  }

  async approveAgentProfileSkill(
    workspaceSlug: string,
    userId: string,
    pendingId: string,
    data: { owner_id: string; skill_id: string; expected_revision: string; content_revision: string }
  ): Promise<TAgentProfileSkillEditResponse> {
    const path = `${this.getProfilePath(workspaceSlug, userId)}skills/pending/${encodeURIComponent(pendingId)}/approve/`;
    return this.post(path, data).then((response) => response?.data);
  }

  async rejectAgentProfileSkill(
    workspaceSlug: string,
    userId: string,
    pendingId: string,
    data: { owner_id: string; skill_id: string; expected_revision: string }
  ): Promise<TAgentProfileSkillEditResponse> {
    const path = `${this.getProfilePath(workspaceSlug, userId)}skills/pending/${encodeURIComponent(pendingId)}/reject/`;
    return this.post(path, data).then((response) => response?.data);
  }
}

const agentProfileService = new AgentProfileService();

export default agentProfileService;
