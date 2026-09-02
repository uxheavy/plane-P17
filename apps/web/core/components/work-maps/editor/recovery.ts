/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export type TRecoveryRecord = {
  generation: number;
  scene_binary: string;
};

const storageKey = (userId: string, workMapId: string) => `work-map-recovery:${userId}:${workMapId}`;

export const readRecovery = (userId: string, workMapId: string): TRecoveryRecord | null => {
  const value = window.sessionStorage.getItem(storageKey(userId, workMapId));
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("generation" in parsed) ||
      typeof parsed.generation !== "number" ||
      !Number.isInteger(parsed.generation) ||
      parsed.generation < 0 ||
      !("scene_binary" in parsed) ||
      typeof parsed.scene_binary !== "string"
    )
      throw new Error("Invalid Work Map recovery record");
    return { generation: parsed.generation, scene_binary: parsed.scene_binary };
  } catch {
    window.sessionStorage.removeItem(storageKey(userId, workMapId));
    return null;
  }
};

export const writeRecovery = (userId: string, workMapId: string, record: TRecoveryRecord) =>
  window.sessionStorage.setItem(storageKey(userId, workMapId), JSON.stringify(record));

export const clearRecovery = (userId: string, workMapId: string) =>
  window.sessionStorage.removeItem(storageKey(userId, workMapId));
