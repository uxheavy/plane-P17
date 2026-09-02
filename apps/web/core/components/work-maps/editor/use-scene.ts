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
import { decodeScene, encodeScene, getNodeKey, type TStoredScene } from "./scene";

const fileService = new FileService();
const workMapService = new WorkMapService();

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
  const durableSceneRef = useRef("");
  const filesRef = useRef<TWorkMapFiles>({});
  const uploadsRef = useRef(new Map<string, Promise<void>>());
  const applyingFingerprintRef = useRef<string | null>(null);

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
      api.addFiles(Object.values(materialized));
    },
    [api, projectId, workMapId, workspaceSlug]
  );

  const applyElements = useCallback(
    async (elements: readonly ExcalidrawElement[], files: TWorkMapFiles) => {
      if (!api) return;
      await addMaterializedFiles(files);
      const fingerprint = sceneFingerprint(elements);
      applyingFingerprintRef.current = fingerprint;
      api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
      observeElements(elements);
      window.requestAnimationFrame(() => {
        if (applyingFingerprintRef.current === fingerprint) applyingFingerprintRef.current = null;
      });
    },
    [addMaterializedFiles, api, observeElements]
  );

  const applyAuthoritativeScene = useCallback(
    async (scene: TWorkMapScene) => {
      const decoded = decodeScene(scene.scene_binary);
      const elements = restoreElements(decoded.elements, null);
      await applyElements(elements, decoded.files);
      generationRef.current = scene.generation;
      durableSceneRef.current = scene.scene_binary;
      filesRef.current = decoded.files;
      return decoded;
    },
    [applyElements]
  );

  const applyRemoteScene = useCallback(
    async (sceneBinary: string) => {
      if (!api) return;
      const remote = decodeScene(sceneBinary);
      const remoteElements = restoreElements(remote.elements, null) as RemoteExcalidrawElement[];
      const elements = reconcileElements(api.getSceneElementsIncludingDeleted(), remoteElements, api.getAppState());
      filesRef.current = { ...filesRef.current, ...remote.files };
      await applyElements(elements, filesRef.current);
    },
    [api, applyElements]
  );

  const serializeScene = useCallback(
    async (elements: readonly OrderedExcalidrawElement[], files: BinaryFiles) => {
      await Promise.all(
        Object.entries(files).map(async ([fileId, file]) => {
          if (filesRef.current[fileId]) return;
          let upload = uploadsRef.current.get(fileId);
          if (!upload) {
            upload = uploadFile(fileService, workspaceSlug, projectId, workMapId, fileId, file).then((metadata) => {
              filesRef.current = { ...filesRef.current, [fileId]: metadata };
              return undefined;
            });
            uploadsRef.current.set(fileId, upload);
          }
          try {
            await upload;
          } finally {
            uploadsRef.current.delete(fileId);
          }
        })
      );
      return encodeScene({ elements: getSyncableElements(elements), files: filesRef.current });
    },
    [projectId, workMapId, workspaceSlug]
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
          files,
        }));
      })
      .then(({ scene, decoded, files }) => {
        if (cancelled) return undefined;
        generationRef.current = scene.generation;
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

  const applyStoredScene = useCallback(
    async (scene: TStoredScene) => {
      filesRef.current = scene.files;
      await applyElements(scene.elements, scene.files);
    },
    [applyElements]
  );

  return {
    initialData,
    initialLoadFailed,
    retryInitialLoad,
    nodeKeys,
    elementCount,
    liveNodeCount,
    generationRef,
    durableSceneRef,
    observeElements,
    isProgrammaticChange,
    serializeScene,
    applyAuthoritativeScene,
    applyRemoteScene,
    applyStoredScene,
  };
};
