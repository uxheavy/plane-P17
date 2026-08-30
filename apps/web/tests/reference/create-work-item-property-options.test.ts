/**
 * Copyright (c) 2026 Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const referenceProject = vi.hoisted(() => {
  const availableOptions = new Set<string>();
  const requests: string[] = [];
  const load = (option: string) =>
    vi.fn(async (workspaceSlug: string, projectId: string) => {
      requests.push(`${option}:${workspaceSlug}:${projectId}`);
      availableOptions.add(option);
    });

  return {
    availableOptions,
    requests,
    fetchCycles: load("cycles"),
    fetchEstimates: load("estimates"),
    fetchLabels: load("labels"),
    fetchMembers: load("members"),
    fetchModules: load("modules"),
    fetchStates: load("states"),
  };
});

vi.mock("../../core/hooks/store/estimates", () => ({
  useProjectEstimates: () => ({
    getEstimateById: () => (referenceProject.availableOptions.has("estimates") ? { id: "estimate-1" } : undefined),
    getProjectEstimates: referenceProject.fetchEstimates,
  }),
}));

vi.mock("../../core/hooks/store/use-cycle", () => ({
  useCycle: () => ({
    fetchAllCycles: referenceProject.fetchCycles,
    getProjectCycleIds: () => (referenceProject.availableOptions.has("cycles") ? [] : null),
  }),
}));

vi.mock("../../core/hooks/store/use-label", () => ({
  useLabel: () => ({
    fetchProjectLabels: referenceProject.fetchLabels,
    getProjectLabelIds: () => (referenceProject.availableOptions.has("labels") ? [] : undefined),
  }),
}));

vi.mock("../../core/hooks/store/use-member", () => ({
  useMember: () => ({
    project: {
      fetchProjectMembers: referenceProject.fetchMembers,
      getProjectMemberFetchStatus: () => referenceProject.availableOptions.has("members"),
    },
  }),
}));

vi.mock("../../core/hooks/store/use-module", () => ({
  useModule: () => ({
    fetchModules: referenceProject.fetchModules,
    getModulesFetchStatusByProjectId: () => referenceProject.availableOptions.has("modules"),
  }),
}));

vi.mock("../../core/hooks/store/use-project", () => ({
  useProject: () => ({
    getProjectById: () => ({ cycle_view: true, estimate: "estimate-1", module_view: true }),
  }),
}));

vi.mock("../../core/hooks/store/use-project-state", () => ({
  useProjectState: () => ({
    fetchProjectStates: referenceProject.fetchStates,
    getProjectStateIds: () => (referenceProject.availableOptions.has("states") ? [] : undefined),
  }),
}));

import { useProjectIssueProperties } from "../../core/hooks/use-project-issue-properties";

describe("reference experience: create-work-item property options", () => {
  beforeEach(() => {
    referenceProject.availableOptions.clear();
    referenceProject.requests.length = 0;
    vi.clearAllMocks();
  });

  it("makes every enabled project option family available once", async () => {
    const { fetchAll } = useProjectIssueProperties();

    await fetchAll("reference-workspace", "reference-project");

    expect(referenceProject.availableOptions).toEqual(
      new Set(["cycles", "estimates", "labels", "members", "modules", "states"])
    );
    expect(referenceProject.requests).toHaveLength(6);
    expect(referenceProject.requests).toEqual(
      expect.arrayContaining([
        "cycles:reference-workspace:reference-project",
        "estimates:reference-workspace:reference-project",
        "labels:reference-workspace:reference-project",
        "members:reference-workspace:reference-project",
        "modules:reference-workspace:reference-project",
        "states:reference-workspace:reference-project",
      ])
    );

    await fetchAll("reference-workspace", "reference-project");

    expect(referenceProject.requests).toHaveLength(6);
  });
});
