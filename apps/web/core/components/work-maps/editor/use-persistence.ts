/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { TWorkMapScene } from "@plane/types";
import { WorkMapService } from "@/services/work-map.service";
import { mergeAuthoritativeScene } from "./merge-authoritative-scene";
import { clearRecovery, readRecovery, writeRecovery, type TRecoveryRecord } from "./recovery";
import { decodeScene, isGenerationConflict } from "./scene";

const service = new WorkMapService();
const MAX_SAVE_ATTEMPTS = 10;
const MAX_RETRY_DELAY_MS = 500;

type TPendingRecovery = TRecoveryRecord & { sequence: number };

const waitForConflictRetry = (attempt: number): Promise<void> => {
  const exponentialDelay = Math.min(MAX_RETRY_DELAY_MS, 50 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 100);
  return new Promise((resolve) => window.setTimeout(resolve, exponentialDelay + jitter));
};

const readInitialRecovery = (userId: string, workMapId: string): TRecoveryRecord | null => {
  if (!userId || typeof window === "undefined") return null;
  return readRecovery(userId, workMapId);
};

export type TRecoveryState =
  | { status: "replayable" }
  | { status: "non-replayable"; reason: "permission-revoked" | "generation-mismatch" };

type TContext = {
  workspaceSlug: string;
  projectId: string;
  workMapId: string;
  userId: string;
};

type TSceneOwners = {
  generationRef: MutableRefObject<number>;
  durableSceneRef: MutableRefObject<string>;
  getAppState: () => Parameters<typeof mergeAuthoritativeScene>[2] | undefined;
  applyStoredScene: (scene: ReturnType<typeof decodeScene>) => Promise<void>;
  applyAuthoritativeScene: (scene: TWorkMapScene) => Promise<unknown>;
};

export const usePersistence = (context: TContext, scene: TSceneOwners) => {
  const { workspaceSlug, projectId, workMapId, userId } = context;
  const [persistenceFailed, setPersistenceFailed] = useState(() => readInitialRecovery(userId, workMapId) !== null);
  const [recoveryRecord, setRecoveryRecord] = useState<TRecoveryRecord | null>(() =>
    readInitialRecovery(userId, workMapId)
  );
  const [recoveryState, setRecoveryState] = useState<TRecoveryState | null>(null);
  const pendingRef = useRef<TPendingRecovery | null>(null);
  const pendingSequenceRef = useRef(0);
  const savingRef = useRef(false);
  const saveTimerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(saveTimerRef.current);
      const pending = pendingRef.current;
      if (!pending || !userId) return;
      try {
        writeRecovery(userId, workMapId, pending);
      } catch {
        // Recovery is best effort during unmount; the in-memory scene has no durable owner after this point.
      }
    },
    [userId, workMapId]
  );

  const retainRecovery = useCallback(
    (record: TRecoveryRecord) => {
      try {
        if (userId) {
          writeRecovery(userId, workMapId, record);
          setRecoveryRecord(record);
        }
      } catch {
        // The editor still freezes when browser storage is unavailable; it must not continue as if the update were durable.
      } finally {
        setPersistenceFailed(true);
      }
    },
    [userId, workMapId]
  );

  const save = useCallback(
    async (pending: TRecoveryRecord) => {
      const appState = scene.getAppState();
      if (!appState || savingRef.current) return;
      savingRef.current = true;
      let persisted = false;
      try {
        for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- each CAS retry must refetch the latest authoritative scene.
          const authoritative = await service.fetchScene(workspaceSlug, projectId, workMapId);
          const reconciled = mergeAuthoritativeScene(pending.scene_binary, authoritative.scene_binary, appState);
          try {
            // oxlint-disable-next-line eslint/no-await-in-loop -- the next attempt depends on this mutation's conflict result.
            const result = await service.saveScene(workspaceSlug, projectId, workMapId, {
              generation: authoritative.generation,
              scene_binary: reconciled.sceneBinary,
            });
            scene.generationRef.current = result.generation;
            scene.durableSceneRef.current = reconciled.sceneBinary;
            if (pendingRef.current?.sequence === pending.sequence) {
              pendingRef.current = null;
              clearRecovery(userId, workMapId);
              setRecoveryRecord(null);
              setRecoveryState(null);
              setPersistenceFailed(false);
            }
            // oxlint-disable-next-line eslint/no-await-in-loop -- applying the winning attempt is part of its ordered CAS flow.
            await scene.applyStoredScene({ elements: reconciled.elements, files: reconciled.files });
            persisted = true;
            return;
          } catch (error) {
            if (!isGenerationConflict(error) || attempt === MAX_SAVE_ATTEMPTS - 1) throw error;
            // oxlint-disable-next-line eslint/no-await-in-loop -- each retry is delayed after the preceding CAS conflict.
            await waitForConflictRetry(attempt);
          }
        }
      } catch (error) {
        const failed = pendingRef.current ?? pending;
        retainRecovery(failed);
        const status =
          error && typeof error === "object" && "response" in error
            ? (error.response as { status?: number } | undefined)?.status
            : undefined;
        setRecoveryState(
          status === 403
            ? { status: "non-replayable", reason: "permission-revoked" }
            : failed.generation === scene.generationRef.current
              ? { status: "replayable" }
              : { status: "non-replayable", reason: "generation-mismatch" }
        );
      } finally {
        savingRef.current = false;
        if (persisted && pendingRef.current) {
          pendingRef.current = { ...pendingRef.current, generation: scene.generationRef.current };
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = window.setTimeout(() => {
            if (pendingRef.current) void save(pendingRef.current);
          }, 350);
        }
      }
    },
    [projectId, retainRecovery, scene, userId, workMapId, workspaceSlug]
  );

  const queue = useCallback(
    (sceneBinary: string) => {
      const pending = {
        generation: scene.generationRef.current,
        scene_binary: sceneBinary,
        sequence: pendingSequenceRef.current + 1,
      };
      pendingSequenceRef.current = pending.sequence;
      pendingRef.current = pending;
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => void save(pending), 350);
    },
    [save, scene.generationRef]
  );

  const evaluateRecovery = useCallback(
    (editable: boolean) => {
      if (!recoveryRecord) {
        setRecoveryState(null);
        return;
      }
      if (recoveryRecord.generation !== scene.generationRef.current) {
        setRecoveryState({ status: "non-replayable", reason: "generation-mismatch" });
        return;
      }
      setRecoveryState(
        editable ? { status: "replayable" } : { status: "non-replayable", reason: "permission-revoked" }
      );
    },
    [recoveryRecord, scene.generationRef]
  );

  const retryRecovery = useCallback(
    async (editable: boolean) => {
      if (!recoveryRecord || !editable) {
        evaluateRecovery(false);
        return;
      }
      try {
        const authoritative = await service.fetchScene(workspaceSlug, projectId, workMapId);
        if (authoritative.generation !== recoveryRecord.generation) {
          setRecoveryState({ status: "non-replayable", reason: "generation-mismatch" });
          return;
        }
        await service.saveScene(workspaceSlug, projectId, workMapId, {
          generation: recoveryRecord.generation,
          scene_binary: recoveryRecord.scene_binary,
        });
        const durable = await service.fetchScene(workspaceSlug, projectId, workMapId);
        await scene.applyAuthoritativeScene(durable);
        clearRecovery(userId, workMapId);
        setRecoveryRecord(null);
        setRecoveryState(null);
        setPersistenceFailed(false);
      } catch (error) {
        if (isGenerationConflict(error)) {
          setRecoveryState({ status: "non-replayable", reason: "generation-mismatch" });
          return;
        }
        const status =
          error && typeof error === "object" && "response" in error
            ? (error.response as { status?: number } | undefined)?.status
            : undefined;
        if (status === 403) setRecoveryState({ status: "non-replayable", reason: "permission-revoked" });
      }
    },
    [evaluateRecovery, projectId, recoveryRecord, scene, userId, workMapId, workspaceSlug]
  );

  const discardRecovery = useCallback(async () => {
    try {
      const authoritative = await service.fetchScene(workspaceSlug, projectId, workMapId);
      await scene.applyAuthoritativeScene(authoritative);
      if (userId) clearRecovery(userId, workMapId);
      pendingRef.current = null;
      setRecoveryRecord(null);
      setRecoveryState(null);
      setPersistenceFailed(false);
    } catch {
      // Keep recovery frozen until the authoritative scene can be fetched and applied.
    }
  }, [projectId, scene, userId, workMapId, workspaceSlug]);

  const markPersistenceFailed = useCallback(() => setPersistenceFailed(true), []);

  return {
    persistenceFailed,
    recoveryRecord,
    recoveryState,
    queue,
    markPersistenceFailed,
    retainRecovery,
    evaluateRecovery,
    retryRecovery,
    discardRecovery,
  };
};
