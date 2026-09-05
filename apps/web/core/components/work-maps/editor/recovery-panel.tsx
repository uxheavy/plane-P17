/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { formatLocalizedTimestamp } from "@plane/utils";
import { useUser } from "@/hooks/store/user";
import type { TRecoveryEntry } from "./use-persistence";

type Props = {
  entries: readonly TRecoveryEntry[];
  onDiscard: (writerId: string) => void;
  pendingScene?: boolean;
  onRetryPendingScene?: () => void;
  onDiscardPendingScene?: () => void;
  storageFailed?: boolean;
  onRetryStorage?: () => void;
};

export const RecoveryPanel = observer(function RecoveryPanel({
  entries,
  onDiscard,
  pendingScene = false,
  onRetryPendingScene,
  onDiscardPendingScene,
  storageFailed = false,
  onRetryStorage,
}: Props) {
  const { currentLocale, t } = useTranslation();
  const { data: user } = useUser();
  const conflictEntries = entries.filter(({ state }) => state?.status === "non-replayable");
  if (!pendingScene && !storageFailed && conflictEntries.length === 0) return null;

  return (
    <div
      data-testid="work-map-recovery"
      className="absolute top-16 left-3 z-20 w-80 rounded-lg border border-subtle bg-surface-1 p-3 shadow-raised-200"
    >
      <div className="mb-3">
        <p className="text-13 font-medium text-primary">{t("common.work_map.recovery.title")}</p>
        <p className="mt-1 text-12 text-secondary">{t("common.work_map.recovery.description")}</p>
      </div>
      {storageFailed && (
        <div data-testid="work-map-recovery-storage" className="mb-3 last:mb-0">
          <p className="text-12 text-primary">{t("common.work_map.recovery.storage_error")}</p>
          <Button
            data-testid="work-map-recovery-storage-retry"
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={onRetryStorage}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}
      {pendingScene && (
        <div data-testid="work-map-pending-scene" className="mb-3 last:mb-0">
          <p className="text-12 text-primary">{t("common.work_map.pending_scene.title")}</p>
          <p className="mt-1 text-12 text-secondary">{t("common.work_map.pending_scene.description")}</p>
          <div className="mt-3 flex gap-2">
            <Button
              data-testid="work-map-pending-scene-retry"
              variant="primary"
              size="sm"
              onClick={onRetryPendingScene}
            >
              {t("common.retry")}
            </Button>
            <Button
              data-testid="work-map-pending-scene-discard"
              variant="secondary"
              size="sm"
              onClick={onDiscardPendingScene}
            >
              {t("common.work_map.pending_scene.reload_saved_scene")}
            </Button>
          </div>
        </div>
      )}
      {conflictEntries.map(({ record, state }) => (
        <div
          key={record.writerId}
          data-state={state?.status ?? "pending"}
          data-reason={state?.status === "non-replayable" ? state.reason : undefined}
          className="mb-3 last:mb-0"
        >
          <p className="text-12 text-primary">
            {t("common.work_map.recovery.unsaved_update", {
              date: formatLocalizedTimestamp(record.writtenAt, currentLocale, user?.user_timezone, "dateTime") ?? "…",
            })}
          </p>
          <Button
            data-testid={`work-map-recovery-discard-${record.writerId}`}
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => onDiscard(record.writerId)}
          >
            {t("common.work_map.recovery.discard_local_changes")}
          </Button>
        </div>
      ))}
    </div>
  );
});
