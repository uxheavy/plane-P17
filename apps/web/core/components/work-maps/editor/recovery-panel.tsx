/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TRecoveryState } from "./use-persistence";

type Props = {
  state: TRecoveryState;
  onRetry: () => void;
  onDiscard: () => void;
};

export function RecoveryPanel({ state, onRetry, onDiscard }: Props) {
  return (
    <div
      data-testid="work-map-recovery"
      data-state={state.status}
      data-reason={state.status === "non-replayable" ? state.reason : undefined}
      className="absolute top-16 left-3 z-20 rounded-lg border border-subtle bg-surface-1 p-3 shadow-raised-200"
    >
      <p className="text-12 text-primary">
        {state.status === "replayable"
          ? "An unsaved update can be retried."
          : "This unsaved update can no longer be applied."}
      </p>
      <div className="mt-2 flex gap-2">
        {state.status === "replayable" && (
          <button
            type="button"
            data-testid="work-map-recovery-retry"
            className="text-12 text-accent-primary"
            onClick={onRetry}
          >
            Retry
          </button>
        )}
        <button
          type="button"
          data-testid="work-map-recovery-discard"
          className="text-12 text-secondary"
          onClick={onDiscard}
        >
          Discard
        </button>
      </div>
    </div>
  );
}
