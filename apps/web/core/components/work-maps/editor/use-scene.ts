/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, getSyncableElements, reconcileElements, restoreElements } from "@excalidraw/excalidraw";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { TWorkMapFiles, TWorkMapScene } from "@plane/types";
import { FileService } from "@/services/file.service";
import { WorkMapService } from "@/services/work-map.service";
import { materializeFiles, uploadFile } from "./assets";
import {
  addWorkMapAssetMetadata,
  decodeScene,
  encodeScene,
  getNodeKey,
  getWorkMapFileMetadata,
  isTransientPersistenceFailure,
  type TWorkMapRuntimeFiles,
} from "./scene";

const fileService = new FileService();
const workMapService = new WorkMapService();
const UPLOAD_RETRY_BASE_DELAY_MS = 250;
const MAX_UPLOAD_RETRY_DELAY_MS = 2_000;

class WorkMapUploadCancelledError extends Error {
  constructor() {
    super("Work map image upload canceled");
    this.name = "AbortError";
  }
}

const waitForUploadRetry = (attempt: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const delay = Math.min(MAX_UPLOAD_RETRY_DELAY_MS, UPLOAD_RETRY_BASE_DELAY_MS * 2 ** Math.min(attempt, 4));
    let timeout: number | undefined;
    const onAbort = () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      reject(new WorkMapUploadCancelledError());
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
  });

const sceneFingerprint = (elements: readonly ExcalidrawElement[]) =>
  elements
    .map((element) => `${element.id}:${element.version}:${element.versionNonce}:${Number(element.isDeleted)}`)
    .join("|");

type TContext = {
  workspaceSlug: string;
  projectId: string;
  workMapId: string;
};

export const useScene = (api: ExcalidrawImperativeAPI | null, context: TContext) => {
  const { workspaceSlug, projectId, workMapId } = context;
  const [initialData, setInitialData] = useState<{ elements: readonly ExcalidrawElement[]; files: BinaryFiles }>();
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);
  const [initialLoadAttempt, setInitialLoadAttempt] = useState(0);
  const [nodeKeys, setNodeKeys] = useState<string[]>([]);
  const [elementCount, setElementCount] = useState(0);
  const [liveNodeCount, setLiveNodeCount] = useState(0);
  const generationRef = useRef(0);
  const collaborationEpochRef = useRef(0);
  const durableSceneRef = useRef("");
  const filesRef = useRef<TWorkMapFiles>({});
  const uploadsRef = useRef(
    new Map<string, { promise: Promise<void>; controller: AbortController; epoch: number; generation: number }>()
  );
  const uploadGenerationRef = useRef(0);
  const activeUploadsRef = useRef(0);
  const mountedRef = useRef(false);
  const [uploadsInProgress, setUploadsInProgress] = useState(false);
  const applyingFingerprintRef = useRef<string | null>(null);

  const cancelUploads = useCallback(() => {
    uploadGenerationRef.current += 1;
    for (const upload of uploadsRef.current.values()) upload.controller.abort();
    uploadsRef.current.clear();
    activeUploadsRef.current = 0;
    if (mountedRef.current) setUploadsInProgress(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelUploads();
    };
  }, [cancelUploads]);

  const observeElements = useCallback((elements: readonly ExcalidrawElement[]) => {
    const keys: string[] = [];
    for (const element of elements) {
      if (element.isDeleted) continue;
      const key = getNodeKey(element);
      if (key) keys.push(key);
    }
    const nextNodeKeys = Array.from(new Set(keys));
    // oxlint-disable-next-line eslint-plugin-unicorn/no-array-sort -- sorting a newly allocated array keeps the target compatible.
    nextNodeKeys.sort();
    setNodeKeys((current) =>
      current.length === nextNodeKeys.length && current.every((nodeKey, index) => nodeKey === nextNodeKeys[index])
        ? current
        : nextNodeKeys
    );
    setElementCount(elements.length);
    setLiveNodeCount(keys.length);
  }, []);

  const addMaterializedFiles = useCallback(
    async (files: TWorkMapFiles) => {
      if (!api) return;
      const currentFiles = api.getFiles();
      const missing = Object.fromEntries(Object.entries(files).filter(([fileId]) => !currentFiles[fileId]));
      if (Object.keys(missing).length === 0) return;
      const materialized = await materializeFiles(fileService, workspaceSlug, projectId, workMapId, missing);
      api.addFiles(Object.values(addWorkMapAssetMetadata(materialized, missing)));
    },
    [api, projectId, workMapId, workspaceSlug]
  );

  const registerPastedFiles = useCallback((files: TWorkMapFiles) => {
    filesRef.current = {
      ...filesRef.current,
      ...Object.fromEntries(Object.entries(files).filter(([fileId]) => !filesRef.current[fileId])),
    };
  }, []);

  const applyElements = useCallback(
    (elements: readonly ExcalidrawElement[]) => {
      if (!api) return;
      const fingerprint = sceneFingerprint(elements);
      applyingFingerprintRef.current = fingerprint;
      api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
      observeElements(elements);
      window.requestAnimationFrame(() => {
        if (applyingFingerprintRef.current === fingerprint) applyingFingerprintRef.current = null;
      });
    },
    [api, observeElements]
  );

  const applyAuthoritativeScene = useCallback(
    async (scene: TWorkMapScene) => {
      const decoded = decodeScene(scene.scene_binary);
      const elements = restoreElements(decoded.elements, null);
      if (scene.generation !== generationRef.current || scene.collaboration_epoch !== collaborationEpochRef.current)
        cancelUploads();
      await addMaterializedFiles(decoded.files);
      applyElements(elements);
      generationRef.current = scene.generation;
      collaborationEpochRef.current = scene.collaboration_epoch;
      durableSceneRef.current = scene.scene_binary;
      filesRef.current = decoded.files;
      return decoded;
    },
    [addMaterializedFiles, applyElements, cancelUploads, collaborationEpochRef, generationRef]
  );

  const applyRemoteScene = useCallback(
    async (sceneBinary: string, epoch = collaborationEpochRef.current) => {
      if (!api) return;
      const remote = decodeScene(sceneBinary);
      const remoteElements = restoreElements(remote.elements, null) as RemoteExcalidrawElement[];
      await addMaterializedFiles(remote.files);
      if (epoch !== collaborationEpochRef.current) return;
      // Read the live gesture only after asynchronous file loading has finished.
      const elements = reconcileElements(api.getSceneElementsIncludingDeleted(), remoteElements, api.getAppState());
      filesRef.current = { ...filesRef.current, ...remote.files };
      applyElements(elements);
    },
    [addMaterializedFiles, api, applyElements]
  );

  const serializeScene = useCallback(
    async (elements: readonly OrderedExcalidrawElement[], files: TWorkMapRuntimeFiles) => {
      const syncableElements = getSyncableElements(elements);
      const uploadEpoch = collaborationEpochRef.current;
      const uploadGeneration = generationRef.current;
      const requestGeneration = uploadGenerationRef.current;
      const referencedFileIds = new Set<string>();
      for (const element of syncableElements) {
        if (element.type === "image" && element.fileId) referencedFileIds.add(element.fileId);
      }
      await Promise.all(
        Object.entries(files)
          .filter(([fileId]) => referencedFileIds.has(fileId))
          .map(async ([fileId, file]) => {
            const knownMetadata = filesRef.current[fileId];
            if (knownMetadata) {
              file.assetId = knownMetadata.assetId;
              return;
            }
            const metadata = getWorkMapFileMetadata(file);
            if (metadata) {
              filesRef.current = { ...filesRef.current, [fileId]: metadata };
              return;
            }
            let upload = uploadsRef.current.get(fileId);
            if (upload && (upload.epoch !== uploadEpoch || upload.generation !== uploadGeneration)) {
              upload.controller.abort();
              uploadsRef.current.delete(fileId);
              upload = undefined;
            }
            if (!upload) {
              const controller = new AbortController();
              const promise = (async () => {
                for (let attempt = 0; ; attempt += 1) {
                  if (
                    controller.signal.aborted ||
                    requestGeneration !== uploadGenerationRef.current ||
                    uploadEpoch !== collaborationEpochRef.current ||
                    uploadGeneration !== generationRef.current
                  )
                    throw new WorkMapUploadCancelledError();
                  try {
                    // oxlint-disable-next-line eslint/no-await-in-loop -- retries must preserve upload order for one file.
                    const uploadMetadata = await uploadFile(
                      fileService,
                      workspaceSlug,
                      projectId,
                      workMapId,
                      fileId,
                      file
                    );
                    if (
                      controller.signal.aborted ||
                      requestGeneration !== uploadGenerationRef.current ||
                      uploadEpoch !== collaborationEpochRef.current ||
                      uploadGeneration !== generationRef.current
                    )
                      throw new WorkMapUploadCancelledError();
                    if (!filesRef.current[fileId]) filesRef.current = { ...filesRef.current, [fileId]: uploadMetadata };
                    file.assetId = uploadMetadata.assetId;
                    return;
                  } catch (error) {
                    if (error instanceof WorkMapUploadCancelledError) throw error;
                    if (!isTransientPersistenceFailure(error)) throw error;
                    // oxlint-disable-next-line eslint/no-await-in-loop -- backoff follows the failed upload attempt.
                    await waitForUploadRetry(attempt, controller.signal);
                  }
                }
              })();
              upload = { promise, controller, epoch: uploadEpoch, generation: uploadGeneration };
              uploadsRef.current.set(fileId, upload);
              activeUploadsRef.current += 1;
              if (mountedRef.current) setUploadsInProgress(true);
              const finishUpload = () => {
                if (uploadsRef.current.get(fileId)?.promise !== promise) return;
                uploadsRef.current.delete(fileId);
                activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1);
                if (mountedRef.current) setUploadsInProgress(activeUploadsRef.current > 0);
              };
              void promise.then(finishUpload, finishUpload);
            }
            await upload.promise;
          })
      );
      const serializedFiles = Object.fromEntries(
        Object.entries(filesRef.current).filter(([fileId]) => referencedFileIds.has(fileId))
      );
      return encodeScene({ elements: syncableElements, files: serializedFiles });
    },
    [collaborationEpochRef, generationRef, projectId, workMapId, workspaceSlug]
  );

  useEffect(() => {
    let cancelled = false;
    workMapService
      .fetchScene(workspaceSlug, projectId, workMapId)
      .then((scene) => {
        const decoded = decodeScene(scene.scene_binary);
        return materializeFiles(fileService, workspaceSlug, projectId, workMapId, decoded.files).then((files) => ({
          scene,
          decoded,
          files: addWorkMapAssetMetadata(files, decoded.files),
        }));
      })
      .then(({ scene, decoded, files }) => {
        if (cancelled) return undefined;
        generationRef.current = scene.generation;
        collaborationEpochRef.current = scene.collaboration_epoch;
        durableSceneRef.current = scene.scene_binary;
        filesRef.current = decoded.files;
        observeElements(decoded.elements);
        setInitialData({ elements: decoded.elements, files });
        return undefined;
      })
      .catch(() => {
        if (!cancelled) setInitialLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initialLoadAttempt, observeElements, projectId, workMapId, workspaceSlug]);

  const retryInitialLoad = useCallback(() => {
    setInitialLoadFailed(false);
    setInitialData(undefined);
    setInitialLoadAttempt((attempt) => attempt + 1);
  }, []);

  const isProgrammaticChange = useCallback((elements: readonly ExcalidrawElement[]) => {
    const fingerprint = sceneFingerprint(elements);
    if (fingerprint !== applyingFingerprintRef.current) return false;
    applyingFingerprintRef.current = null;
    return true;
  }, []);

  return {
    initialData,
    initialLoadFailed,
    retryInitialLoad,
    nodeKeys,
    elementCount,
    liveNodeCount,
    uploadsInProgress,
    cancelUploads,
    generationRef,
    collaborationEpochRef,
    durableSceneRef,
    observeElements,
    isProgrammaticChange,
    registerPastedFiles,
    serializeScene,
    applyAuthoritativeScene,
    applyRemoteScene,
  };
};
