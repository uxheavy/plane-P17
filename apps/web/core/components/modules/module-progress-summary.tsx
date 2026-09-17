/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { LinearProgress } from "@makeplane/propel/components/linear-progress";
import { WorkItemsIcon } from "@plane/propel/icons";
import type { IModule } from "@plane/types";

type Props = Pick<
  IModule,
  "backlog_issues" | "unstarted_issues" | "started_issues" | "completed_issues" | "cancelled_issues"
> & {
  trailingContent?: ReactNode;
};

export function ModuleProgressSummary({
  backlog_issues,
  unstarted_issues,
  started_issues,
  completed_issues,
  cancelled_issues,
  trailingContent,
}: Props) {
  const totalIssues = backlog_issues + unstarted_issues + started_issues + completed_issues + cancelled_issues;
  const issueCount =
    totalIssues === 0
      ? "0 work items"
      : totalIssues === completed_issues
        ? `${totalIssues} Work item${totalIssues > 1 ? "s" : ""}`
        : `${completed_issues}/${totalIssues} Work items`;
  const progressValue = totalIssues > 0 ? (completed_issues / totalIssues) * 100 : 0;

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-secondary">
          <WorkItemsIcon className="h-4 w-4 text-tertiary" />
          <span className="text-11 text-tertiary">{issueCount}</span>
        </div>
        {trailingContent}
      </div>
      <LinearProgress value={progressValue} size="md" variant="brand" showValue={false} aria-label="Module progress" />
    </>
  );
}
