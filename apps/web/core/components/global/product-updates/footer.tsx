/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useTranslation } from "@plane/i18n";
// ui
import { CompanyRunnerLogo } from "@plane/propel/icons";

export function ProductUpdatesFooter() {
  const { t } = useTranslation();
  return (
    <div className="m-6 mb-4 flex flex-shrink-0 justify-end gap-4">
      <div className="flex items-center gap-1.5 text-center text-13 font-medium text-secondary">
        <CompanyRunnerLogo className="h-4 w-auto text-primary" />
        {t("powered_by_plane_pages")}
      </div>
    </div>
  );
}
