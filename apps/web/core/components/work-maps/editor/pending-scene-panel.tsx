/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

type Props = {
  onRetry: () => void;
  onDiscard: () => void;
};

export function PendingScenePanel({ onRetry, onDiscard }: Props) {
  return (
    <div
      data-testid="work-map-pending-scene"
      className="shadow-lg absolute top-14 left-3 z-20 w-80 rounded-lg border border-danger-subtle bg-surface-1 p-3"
    >
      <p className="text-13 font-medium text-primary">The latest change could not be prepared for saving.</p>
      <p className="mt-1 text-12 text-secondary">Retry it, or reload the last saved scene.</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          data-testid="work-map-pending-scene-retry"
          className="rounded-md bg-accent-primary px-3 py-1.5 text-12 font-medium text-on-color"
          onClick={onRetry}
        >
          Retry
        </button>
        <button
          type="button"
          data-testid="work-map-pending-scene-discard"
          className="rounded-md border border-subtle px-3 py-1.5 text-12 font-medium text-secondary"
          onClick={onDiscard}
        >
          Reload saved scene
        </button>
      </div>
    </div>
  );
}
