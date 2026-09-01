/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useProjectEstimates } from "../store/estimates/use-project-estimate";
import { useCycle } from "../store/use-cycle";
import { useLabel } from "../store/use-label";
import { useMember } from "../store/use-member";
import { useModule } from "../store/use-module";
import { useProject } from "../store/use-project";
import { useProjectState } from "../store/use-project-state";
import { preloadMissingProjectIssuePropertyOptions } from "./preload";

export const useProjectIssueProperties = () => {
  const { fetchProjectStates, getProjectStateIds } = useProjectState();
  const {
    project: { fetchProjectMembers, getProjectMemberFetchStatus },
  } = useMember();
  const { fetchProjectLabels, getProjectLabelIds } = useLabel();
  const { fetchAllCycles: fetchProjectAllCycles, getProjectCycleIds } = useCycle();
  const { fetchModules: fetchProjectAllModules, getModulesFetchStatusByProjectId } = useModule();
  const { getProjectEstimates, getEstimateById } = useProjectEstimates();
  const { getProjectById } = useProject();

  // fetching project states
  const fetchStates = async (
    workspaceSlug: string | string[] | undefined,
    projectId: string | string[] | undefined
  ) => {
    if (workspaceSlug && projectId) {
      await fetchProjectStates(workspaceSlug.toString(), projectId.toString());
    }
  };
  // fetching project members
  const fetchMembers = async (
    workspaceSlug: string | string[] | undefined,
    projectId: string | string[] | undefined
  ) => {
    if (workspaceSlug && projectId) {
      await fetchProjectMembers(workspaceSlug.toString(), projectId.toString());
    }
  };

  // fetching project labels
  const fetchLabels = async (
    workspaceSlug: string | string[] | undefined,
    projectId: string | string[] | undefined
  ) => {
    if (workspaceSlug && projectId) {
      await fetchProjectLabels(workspaceSlug.toString(), projectId.toString());
    }
  };
  // fetching project cycles
  const fetchCycles = async (
    workspaceSlug: string | string[] | undefined,
    projectId: string | string[] | undefined
  ) => {
    if (workspaceSlug && projectId) {
      await fetchProjectAllCycles(workspaceSlug.toString(), projectId.toString());
    }
  };
  // fetching project modules
  const fetchModules = async (
    workspaceSlug: string | string[] | undefined,
    projectId: string | string[] | undefined
  ) => {
    if (workspaceSlug && projectId) {
      await fetchProjectAllModules(workspaceSlug.toString(), projectId.toString());
    }
  };
  // fetching project estimates
  const fetchEstimates = async (
    workspaceSlug: string | string[] | undefined,
    projectId: string | string[] | undefined
  ) => {
    if (workspaceSlug && projectId) {
      await getProjectEstimates(workspaceSlug.toString(), projectId.toString());
    }
  };

  const fetchAll = async (workspaceSlug: string | string[] | undefined, projectId: string | string[] | undefined) => {
    if (workspaceSlug && projectId) {
      const projectKey = projectId.toString();
      const project = getProjectById(projectKey);

      await preloadMissingProjectIssuePropertyOptions([
        { isLoaded: getProjectStateIds(projectKey) !== undefined, load: () => fetchStates(workspaceSlug, projectId) },
        { isLoaded: getProjectMemberFetchStatus(projectKey), load: () => fetchMembers(workspaceSlug, projectId) },
        { isLoaded: getProjectLabelIds(projectKey) !== undefined, load: () => fetchLabels(workspaceSlug, projectId) },
        {
          isEnabled: project?.cycle_view !== false,
          isLoaded: getProjectCycleIds(projectKey) !== null,
          load: () => fetchCycles(workspaceSlug, projectId),
        },
        {
          isEnabled: project?.module_view !== false,
          isLoaded: getModulesFetchStatusByProjectId(projectKey),
          load: () => fetchModules(workspaceSlug, projectId),
        },
        {
          isEnabled: Boolean(project?.estimate),
          isLoaded: !project?.estimate || getEstimateById(project.estimate) !== undefined,
          load: () => fetchEstimates(workspaceSlug, projectId),
        },
      ]);
    }
  };

  return {
    fetchAll,
    fetchStates,
    fetchMembers,
    fetchLabels,
    fetchCycles,
    fetchModules,
    fetchEstimates,
  };
};
