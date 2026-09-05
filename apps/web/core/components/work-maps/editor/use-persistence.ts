/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { TWorkMapScene } from "@plane/types";
import { WorkMapService } from "@/services/work-map.service";
import {
  clearRecoverySlot,
  createRecoveryWriter,
  readRecovery,
  withRecoveryWriterLock,
  type TRecoveryRecord,
  type TRecoveryWriter,
} from "@/services/work-map-recovery.service";
import { mergeAuthoritativeScene } from "./merge-authoritative-scene";
import { isGenerationConflict, isTransientPersistenceFailure, type TSceneAuthority } from "./scene";

const service = new WorkMapService();
const MAX_SAVE_ATTEMPTS = 10;
const MAX_RETRY_DELAY_MS = 500;
const BACKGROUND_RETRY_BASE_DELAY_MS = 1_000;
const MAX_BACKGROUND_RETRY_DELAY_MS = 30_000;

type TPendingRecovery = {
  collaboration_epoch: number;
  generation: number;
  scene_binary: string;
  sequence: number;
  writtenAt?: number;
  expiresAt?: number;
};

const waitForSaveRetry = (attempt: number): Promise<void> => {
  const exponentialDelay = Math.min(MAX_RETRY_DELAY_MS, 50 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 100);
  return new Promise((resolve) => window.setTimeout(resolve, exponentialDelay + jitter));
};

type TInitialRecovery = { records: TRecoveryRecord[]; storageFailed: boolean };

const readInitialRecovery = (userId: string, workMapId: string): TInitialRecovery => {
  if (!userId || typeof window === "undefined") return { records: [], storageFailed: false };
  try {
    return { records: readRecovery(userId, workMapId), storageFailed: false };
  } catch {
    return { records: [], storageFailed: true };
  }
};

export type TRecoveryState =
  | { status: "replayable" }
  | {
      status: "non-replayable";
      reason: "permission-revoked" | "authority-mismatch" | "persistence-failed" | "expired";
    };

export type TPersistenceStatus = "silent" | "pending" | "saving" | "error";

export type TRecoveryEntry = {
  record: TRecoveryRecord;
  state: TRecoveryState | null;
};

type TContext = {
  workspaceSlug: string;
  projectId: string;
  workMapId: string;
  userId: string;
};

type TSceneOwners = {
  generationRef: MutableRefObject<number>;
  collaborationEpochRef: MutableRefObject<number>;
  durableSceneRef: MutableRefObject<string>;
  hasPendingSerialization?: () => boolean;
  getAppState: () => Parameters<typeof mergeAuthoritativeScene>[2] | undefined;
  applyRemoteScene: (sceneBinary: string, epoch?: number) => Promise<void>;
  applyAuthoritativeScene: (scene: TWorkMapScene) => Promise<unknown>;
};

export const usePersistence = (context: TContext, scene: TSceneOwners) => {
  const { workspaceSlug, projectId, workMapId, userId } = context;
  const [initialRecovery] = useState<TInitialRecovery>(() => readInitialRecovery(userId, workMapId));
  const [writerResult, setWriterResult] = useState<{ writer: TRecoveryWriter | null; storageFailed: boolean }>(() => {
    if (!userId) return { writer: null, storageFailed: false };
    try {
      return { writer: createRecoveryWriter({ accountId: userId, workMapId }), storageFailed: false };
    } catch {
      return { writer: null, storageFailed: true };
    }
  });
  const recoveryWriter = writerResult.writer;
  const recoveryWriterRef = useRef<TRecoveryWriter | null>(recoveryWriter);
  const initialStorageFailed = initialRecovery.storageFailed || writerResult.storageFailed;
  const [persistenceFailed, setPersistenceFailed] = useState(() => initialStorageFailed);
  const [persistenceStatus, setPersistenceStatus] = useState<TPersistenceStatus>(() =>
    initialStorageFailed ? "error" : "silent"
  );
  const [recoveryStorageFailed, setRecoveryStorageFailed] = useState(initialStorageFailed);
  const [recoveryRecords, setRecoveryRecords] = useState<TRecoveryRecord[]>(initialRecovery.records);
  const [recoveryStates, setRecoveryStates] = useState<Record<string, TRecoveryState>>({});
  const pendingRef = useRef<TPendingRecovery | null>(null);
  const pendingSequenceRef = useRef(0);
  const savingRef = useRef(false);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const backgroundRetryDelayRef = useRef(0);
  const recoveryEditableRef = useRef(false);
  const recoveryRetryRef = useRef<(writerId: string, editable: boolean) => Promise<void>>(() => Promise.resolve());
  const automaticRecoveryRef = useRef(new Set<string>());

  const ensureRecoveryWriter = useCallback(() => {
    if (!userId) return null;
    if (recoveryWriterRef.current) return recoveryWriterRef.current;
    try {
      const writer = createRecoveryWriter({ accountId: userId, workMapId });
      recoveryWriterRef.current = writer;
      setWriterResult({ writer, storageFailed: false });
      return writer;
    } catch {
      return null;
    }
  }, [userId, workMapId]);

  const refreshRecovery = useCallback(() => {
    if (!userId) return [];
    try {
      const records = readRecovery(userId, workMapId);
      setRecoveryRecords(records);
      setRecoveryStorageFailed(false);
      return records;
    } catch {
      setPersistenceFailed(true);
      setPersistenceStatus("error");
      setRecoveryStorageFailed(true);
      return null;
    }
  }, [userId, workMapId]);

  const retryRecoveryStorage = useCallback(() => {
    const writer = ensureRecoveryWriter();
    if (!writer) {
      setPersistenceFailed(true);
      setPersistenceStatus("error");
      setRecoveryStorageFailed(true);
      return false;
    }
    const records = refreshRecovery();
    if (!records) return false;
    setPersistenceFailed((current) => (records.length === 0 ? false : current));
    setPersistenceStatus((current) => (records.length === 0 ? "silent" : current));
    return true;
  }, [ensureRecoveryWriter, refreshRecovery]);

  useEffect(() => {
    recoveryWriterRef.current?.activate();
    return () => {
      window.clearTimeout(saveTimerRef.current);
      const pending = pendingRef.current;
      const writer = recoveryWriterRef.current;
      try {
        if (pending && pending.expiresAt && pending.expiresAt > Date.now() && writer)
          writer.retain(pending.generation, pending.scene_binary, pending.collaboration_epoch);
      } catch {
        // Storage errors are reported while mounted; unmount cannot render a recovery state.
      } finally {
        // Release the local registry entry; StrictMode may replay this cleanup/setup pair.
        writer?.release();
      }
    };
    // The ref handles a writer created after a transient storage failure; rerunning this effect would
    // release a newly-created writer and cancel its write-ahead timer before its replacement setup.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retainJournal = useCallback(
    (record: TPendingRecovery): TRecoveryRecord | null => {
      const writer = ensureRecoveryWriter();
      if (!writer) throw new Error("Work map recovery writer is unavailable");
      const retained = writer.retain(record.generation, record.scene_binary, record.collaboration_epoch);
      if (!retained) return null;
      if (!refreshRecovery()) return null;
      return retained;
    },
    [ensureRecoveryWriter, refreshRecovery]
  );

  const retainRecovery = useCallback(
    (record: TPendingRecovery): boolean => {
      try {
        const retained = retainJournal(record);
        if (!retained) {
          setPersistenceFailed(true);
          setPersistenceStatus("error");
          return false;
        }
        record.writtenAt = retained.writtenAt;
        record.expiresAt = retained.expiresAt;
        setRecoveryStates((current) => ({ ...current, [retained.writerId]: { status: "replayable" } }));
        return true;
      } catch {
        // The editor must remain frozen when browser storage cannot retain exact bytes.
        setPersistenceFailed(true);
        setPersistenceStatus("error");
        setRecoveryStorageFailed(true);
        return false;
      }
    },
    [retainJournal]
  );

  const save = useCallback(
    async (pending: TPendingRecovery) => {
      const appState = scene.getAppState();
      if (!appState || savingRef.current) return;
      savingRef.current = true;
      setPersistenceStatus("saving");
      let persisted = false;
      let authorityChanged = false;
      try {
        for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
          try {
            // oxlint-disable-next-line eslint/no-await-in-loop -- each retry refetches the latest authoritative scene.
            const authoritative = await service.fetchScene(workspaceSlug, projectId, workMapId);
            if (pending.collaboration_epoch !== authoritative.collaboration_epoch) {
              authorityChanged = true;
              throw new Error("Work map authority changed while saving");
            }
            const reconciled = mergeAuthoritativeScene(pending.scene_binary, authoritative.scene_binary, appState);
            // oxlint-disable-next-line eslint/no-await-in-loop -- the next attempt depends on this mutation's conflict result.
            const result = await service.saveScene(workspaceSlug, projectId, workMapId, {
              collaboration_epoch: pending.collaboration_epoch,
              generation: authoritative.generation,
              scene_binary: reconciled.sceneBinary,
            });
            if (pending.collaboration_epoch !== scene.collaborationEpochRef.current) {
              authorityChanged = true;
              throw new Error("Work map authority changed while saving");
            }
            scene.generationRef.current = result.generation;
            scene.durableSceneRef.current = reconciled.sceneBinary;
            if (pendingRef.current?.sequence === pending.sequence) {
              pendingRef.current = null;
              const writer = recoveryWriterRef.current;
              writer?.clear();
              const records = refreshRecovery();
              if (records) {
                // Another tab's in-flight journal does not make this acknowledged save a failure.
                setPersistenceFailed(false);
                setPersistenceStatus("silent");
              }
              setRecoveryStates((current) => {
                const next = { ...current };
                if (writer) delete next[writer.writerId];
                return next;
              });
            }
            // A save response may lag local edits; reconcile against the live canvas, never replace it.
            // oxlint-disable-next-line eslint/no-await-in-loop -- reconciling the winning attempt is part of its ordered CAS flow.
            await scene.applyRemoteScene(reconciled.sceneBinary, pending.collaboration_epoch);
            persisted = true;
            return;
          } catch (error) {
            if (
              (!isGenerationConflict(error) && !isTransientPersistenceFailure(error)) ||
              attempt === MAX_SAVE_ATTEMPTS - 1
            )
              throw error;
            // oxlint-disable-next-line eslint/no-await-in-loop -- each retry is delayed after the preceding conflict or transient failure.
            await waitForSaveRetry(attempt);
          }
        }
      } catch (error) {
        const failed = pendingRef.current ?? pending;
        const retained = retainRecovery(failed);
        const transient = isTransientPersistenceFailure(error);
        const generationConflict = isGenerationConflict(error);
        const status =
          error && typeof error === "object" && "response" in error
            ? (error.response as { status?: number } | undefined)?.status
            : undefined;
        const replayable = retained && !authorityChanged && (transient || generationConflict);
        const writer = recoveryWriterRef.current;
        if (writer) {
          setRecoveryStates((current) => ({
            ...current,
            [writer.writerId]:
              status === 403
                ? { status: "non-replayable", reason: "permission-revoked" }
                : authorityChanged
                  ? { status: "non-replayable", reason: "authority-mismatch" }
                  : replayable
                    ? { status: "replayable" }
                    : { status: "non-replayable", reason: "persistence-failed" },
          }));
        }
        if (replayable) {
          // Retained transport and same-epoch CAS failures are recoverable; keep the canvas editable while backing off.
          setPersistenceFailed(false);
          setPersistenceStatus("error");
          const delay = backgroundRetryDelayRef.current || BACKGROUND_RETRY_BASE_DELAY_MS;
          backgroundRetryDelayRef.current = Math.min(MAX_BACKGROUND_RETRY_DELAY_MS, delay * 2);
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = window.setTimeout(
            () => {
              saveTimerRef.current = undefined;
              if (pendingRef.current) void save(pendingRef.current);
            },
            delay + Math.floor(Math.random() * 100)
          );
        } else {
          setPersistenceFailed(true);
          setPersistenceStatus("error");
          backgroundRetryDelayRef.current = 0;
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = undefined;
        }
      } finally {
        savingRef.current = false;
        if (persisted) backgroundRetryDelayRef.current = 0;
        if (
          persisted &&
          pendingRef.current &&
          pendingRef.current.collaboration_epoch === scene.collaborationEpochRef.current
        ) {
          pendingRef.current = { ...pendingRef.current, generation: scene.generationRef.current };
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = undefined;
            if (pendingRef.current) void save(pendingRef.current);
          }, 350);
        }
      }
    },
    [projectId, refreshRecovery, retainRecovery, scene, workMapId, workspaceSlug]
  );

  const queue = useCallback(
    (sceneBinary: string, authority: TSceneAuthority): "queued" | "unchanged" | "blocked" => {
      // Excalidraw also notifies on UI renders; identical retained bytes must not restart the save timer.
      if (!persistenceFailed && pendingRef.current?.scene_binary === sceneBinary && pendingRef.current.expiresAt)
        return "unchanged";
      const pending: TPendingRecovery = {
        collaboration_epoch: authority.collaboration_epoch,
        generation: authority.generation,
        scene_binary: sceneBinary,
        sequence: pendingSequenceRef.current + 1,
      };
      pendingSequenceRef.current = pending.sequence;
      pendingRef.current = pending;
      if (authority.collaboration_epoch !== scene.collaborationEpochRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
        backgroundRetryDelayRef.current = 0;
        retainRecovery(pending);
        setPersistenceFailed(true);
        setPersistenceStatus("error");
        return "blocked";
      }
      const writer = ensureRecoveryWriter();
      if (!writer) {
        setPersistenceFailed(true);
        setPersistenceStatus("error");
        return "blocked";
      }
      const retainAndSchedule = (): "queued" | "blocked" => {
        try {
          const retained = retainJournal(pending);
          if (!retained) {
            setPersistenceFailed(true);
            setPersistenceStatus("error");
            return "blocked";
          }
          pending.writtenAt = retained.writtenAt;
          pending.expiresAt = retained.expiresAt;
        } catch {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = undefined;
          backgroundRetryDelayRef.current = 0;
          setPersistenceFailed(true);
          setPersistenceStatus("error");
          setRecoveryStorageFailed(true);
          return "blocked";
        }
        setPersistenceStatus("pending");
        window.clearTimeout(saveTimerRef.current);
        const delay = backgroundRetryDelayRef.current || 350;
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = undefined;
          void save(pending);
        }, delay);
        return "queued";
      };
      if (!writer.isReady()) {
        setPersistenceStatus("pending");
        void writer.whenReady().then((available) => {
          if (pendingRef.current?.sequence !== pending.sequence) return undefined;
          if (!available) {
            setPersistenceFailed(true);
            setPersistenceStatus("error");
            return undefined;
          }
          retainAndSchedule();
          return undefined;
        });
        return "queued";
      }
      return retainAndSchedule();
    },
    [ensureRecoveryWriter, persistenceFailed, retainJournal, retainRecovery, save, scene]
  );

  const evaluateRecovery = useCallback(
    (editable: boolean) => {
      recoveryEditableRef.current = editable;
      setRecoveryStates(
        Object.fromEntries(
          recoveryRecords.map((record) => [
            record.writerId,
            record.collaboration_epoch !== scene.collaborationEpochRef.current
              ? { status: "non-replayable", reason: "authority-mismatch" }
              : editable
                ? { status: "replayable" }
                : { status: "non-replayable", reason: "permission-revoked" },
          ])
        )
      );
    },
    [recoveryRecords, scene.collaborationEpochRef]
  );

  const retryRecovery = useCallback(
    async (writerId: string, editable: boolean) => {
      const cachedRecord = recoveryRecords.find((record) => record.writerId === writerId);
      if (!editable) {
        setRecoveryStates((current) => ({
          ...current,
          ...(cachedRecord ? { [writerId]: { status: "non-replayable", reason: "permission-revoked" } } : {}),
        }));
        return;
      }
      const recover = async () => {
        try {
          const authoritative = await service.fetchScene(workspaceSlug, projectId, workMapId);
          const records = refreshRecovery();
          if (!records) return;
          const recoveryRecord = records.find((record) => record.writerId === writerId);
          if (!recoveryRecord) {
            setRecoveryStates((current) => {
              const next = { ...current };
              delete next[writerId];
              return next;
            });
            setPersistenceFailed(records.length > 0);
            setPersistenceStatus(records.length > 0 ? "error" : "silent");
            return;
          }
          const pending = pendingRef.current;
          if (pending || scene.hasPendingSerialization?.()) {
            // A live draft owns the current canvas; never replace it with an older journal slot.
            if (pending?.scene_binary === recoveryRecord.scene_binary) await save(pending);
            return;
          }
          const recoveryEpoch = recoveryRecord.collaboration_epoch;
          if (
            recoveryEpoch === undefined ||
            authoritative.collaboration_epoch !== recoveryEpoch ||
            scene.collaborationEpochRef.current !== recoveryEpoch
          ) {
            setRecoveryStates((current) => ({
              ...current,
              [writerId]: { status: "non-replayable", reason: "authority-mismatch" },
            }));
            setPersistenceFailed(true);
            setPersistenceStatus("error");
            return;
          }
          const appState = scene.getAppState();
          if (!appState) return;
          const reconciled = mergeAuthoritativeScene(recoveryRecord.scene_binary, authoritative.scene_binary, appState);
          await service.saveScene(workspaceSlug, projectId, workMapId, {
            collaboration_epoch: recoveryEpoch,
            // A newer same-epoch revision is a normal CAS race; merge against it and write at its generation.
            generation: authoritative.generation,
            scene_binary: reconciled.sceneBinary,
          });
          const durable = await service.fetchScene(workspaceSlug, projectId, workMapId);
          if (durable.collaboration_epoch !== scene.collaborationEpochRef.current) {
            setRecoveryStates((current) => ({
              ...current,
              [writerId]: { status: "non-replayable", reason: "authority-mismatch" },
            }));
            setPersistenceFailed(true);
            setPersistenceStatus("error");
            return;
          }
          scene.generationRef.current = durable.generation;
          scene.durableSceneRef.current = durable.scene_binary;
          // Reconcile against live elements so edits made during recovery stay live.
          await scene.applyRemoteScene(durable.scene_binary, durable.collaboration_epoch);
          const writer = recoveryWriterRef.current;
          if (writer?.writerId === writerId) writer.clear();
          else clearRecoverySlot(userId, workMapId, writerId);
          if (pendingRef.current?.scene_binary === recoveryRecord.scene_binary) pendingRef.current = null;
          const remainingRecords = refreshRecovery();
          setRecoveryStates((current) => {
            const next = { ...current };
            delete next[writerId];
            return next;
          });
          if (remainingRecords) {
            setPersistenceFailed(remainingRecords.length > 0);
            setPersistenceStatus(remainingRecords.length > 0 ? "error" : "silent");
          }
        } catch (error) {
          const generationConflict = isGenerationConflict(error);
          const status =
            error && typeof error === "object" && "response" in error
              ? (error.response as { status?: number } | undefined)?.status
              : undefined;
          const transient = isTransientPersistenceFailure(error);
          if (generationConflict && editable) {
            setRecoveryStates((current) => ({
              ...current,
              [writerId]: { status: "replayable" },
            }));
          }
          if ((generationConflict || transient) && editable) {
            setPersistenceFailed(false);
            setPersistenceStatus("error");
            const delay = backgroundRetryDelayRef.current || BACKGROUND_RETRY_BASE_DELAY_MS;
            backgroundRetryDelayRef.current = Math.min(MAX_BACKGROUND_RETRY_DELAY_MS, delay * 2);
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = window.setTimeout(
              () => {
                saveTimerRef.current = undefined;
                void recoveryRetryRef.current(writerId, recoveryEditableRef.current);
              },
              delay + Math.floor(Math.random() * 100)
            );
            return;
          }
          setPersistenceFailed(true);
          setPersistenceStatus("error");
          if (status === 403)
            setRecoveryStates((current) => ({
              ...current,
              [writerId]: { status: "non-replayable", reason: "permission-revoked" },
            }));
          else
            setRecoveryStates((current) => ({
              ...current,
              [writerId]: { status: "non-replayable", reason: "persistence-failed" },
            }));
        }
      };
      await withRecoveryWriterLock(userId, workMapId, writerId, recover);
    },
    [projectId, recoveryRecords, refreshRecovery, save, scene, userId, workMapId, workspaceSlug]
  );

  useEffect(() => {
    recoveryRetryRef.current = retryRecovery;
  }, [retryRecovery]);

  useEffect(() => {
    if (!recoveryEditableRef.current) return;
    for (const record of recoveryRecords) {
      if (recoveryStates[record.writerId]?.status !== "replayable" || automaticRecoveryRef.current.has(record.writerId))
        continue;
      if (recoveryWriter?.writerId === record.writerId) continue;
      automaticRecoveryRef.current.add(record.writerId);
      void recoveryRetryRef.current(record.writerId, true).finally(() => {
        automaticRecoveryRef.current.delete(record.writerId);
      });
    }
  }, [recoveryRecords, recoveryStates, recoveryWriter]);

  const discardRecovery = useCallback(
    async (writerId: string) => {
      const recoveryRecord = recoveryRecords.find((record) => record.writerId === writerId);
      if (!recoveryRecord) return;
      try {
        const authoritative = await service.fetchScene(workspaceSlug, projectId, workMapId);
        await scene.applyAuthoritativeScene(authoritative);
        const writer = recoveryWriterRef.current;
        if (writer?.writerId === writerId) writer.clear();
        else clearRecoverySlot(userId, workMapId, writerId);
        if (pendingRef.current?.scene_binary === recoveryRecord.scene_binary) pendingRef.current = null;
        const records = refreshRecovery();
        setRecoveryStates((current) => {
          const next = { ...current };
          delete next[writerId];
          return next;
        });
        if (records) {
          setPersistenceFailed(records.length > 0);
          setPersistenceStatus(records.length > 0 ? "error" : "silent");
        }
      } catch {
        // Keep recovery frozen until the authoritative scene can be fetched and applied.
      }
    },
    [projectId, recoveryRecords, refreshRecovery, scene, userId, workMapId, workspaceSlug]
  );

  const markPersistenceFailed = useCallback(() => {
    setPersistenceFailed(true);
    setPersistenceStatus("error");
  }, []);

  const hasPendingDraft = useCallback(
    () => pendingRef.current !== null || Boolean(scene.hasPendingSerialization?.()),
    [scene]
  );

  const resumePendingDraft = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending || savingRef.current) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = undefined;
    await save(pending);
  }, [save]);

  const recoveryEntries = useMemo(
    () => recoveryRecords.map((record) => ({ record, state: recoveryStates[record.writerId] ?? null })),
    [recoveryRecords, recoveryStates]
  );

  return {
    persistenceFailed,
    persistenceStatus,
    recoveryStorageFailed,
    recoveryRecords,
    recoveryEntries,
    queue,
    markPersistenceFailed,
    retainRecovery,
    evaluateRecovery,
    retryRecoveryStorage,
    hasPendingDraft,
    resumePendingDraft,
    retryRecovery,
    discardRecovery,
  };
};
