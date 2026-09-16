/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { RotateCcw } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";

export function ConversationError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-md border border-danger-subtle bg-danger-subtle/40 px-3 py-3 text-center text-11 text-danger-secondary"
      role="alert"
    >
      <span>{message}</span>
      {onRetry ? (
        <Button onClick={onRetry} prependIcon={<RotateCcw />} size="sm" variant="secondary">
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  );
}
