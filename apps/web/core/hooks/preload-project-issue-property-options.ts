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
  await Promise.allSettled(
    options.filter(({ isEnabled = true, isLoaded }) => isEnabled && !isLoaded).map(({ load }) => load())
  );
};
