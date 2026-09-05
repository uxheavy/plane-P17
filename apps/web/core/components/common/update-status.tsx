/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { RefreshCw } from "lucide-react";

export type TUpdateStatus = "saving" | "saved" | "error";

type Props = {
  status: TUpdateStatus;
  errorLabel?: string;
};

export function UpdateStatus({ status, errorLabel = "Not saved" }: Props) {
  return (
    <div
      className={`flex items-center gap-x-2 transition-all duration-300 ${status === "saved" ? "fade-out" : "fade-in"}`}
    >
      {status === "saving" && <RefreshCw className="size-3.5 animate-spin stroke-tertiary" />}
      <span className="text-13 text-tertiary">
        {status === "saving" ? "Saving..." : status === "error" ? errorLabel : "Saved"}
      </span>
    </div>
  );
}
