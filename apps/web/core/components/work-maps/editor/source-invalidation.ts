/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const parseSourceInvalidationFrame = (message: Record<string, unknown>): string[] | null => {
  if (message.type !== "SOURCE_PROJECTIONS_INVALIDATED") return null;
  const payload = message.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("nodeKeys" in payload))
    throw new Error("Invalid source invalidation frame");
  const nodeKeys = payload.nodeKeys;
  if (!Array.isArray(nodeKeys) || nodeKeys.length > 100 || nodeKeys.some((nodeKey) => typeof nodeKey !== "string"))
    throw new Error("Invalid source invalidation frame");
  return [...new Set(nodeKeys)];
};

export const getCurrentInvalidatedNodeKeys = (currentNodeKeys: string[], invalidatedNodeKeys: string[]): string[] => {
  const current = new Set(currentNodeKeys);
  return invalidatedNodeKeys.filter((nodeKey) => current.has(nodeKey));
};
