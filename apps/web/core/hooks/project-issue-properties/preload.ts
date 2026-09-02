/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2026 Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

type TProjectIssuePropertyPreload = {
  isEnabled?: boolean;
  isLoaded: boolean;
  load: () => Promise<unknown>;
};

export const preloadMissingProjectIssuePropertyOptions = async (options: TProjectIssuePropertyPreload[]) => {
  const pendingLoads: Promise<unknown>[] = [];
  for (const { isEnabled = true, isLoaded, load } of options) {
    if (isEnabled && !isLoaded) pendingLoads.push(load());
  }
  await Promise.allSettled(pendingLoads);
};
