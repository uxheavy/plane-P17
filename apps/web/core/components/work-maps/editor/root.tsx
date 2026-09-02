/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { CaptureUpdateAction, Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawEmbeddableElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
// oxlint-disable-next-line import/no-unassigned-import -- Excalidraw owns its editor styles.
import "@excalidraw/excalidraw/index.css";
import type { TWorkMap, TWorkMapSource } from "@plane/types";
import { useAppRouter } from "@/hooks/use-app-router";
import { useWorkMap } from "@/hooks/store/use-work-map";
import { useUser } from "@/hooks/store/user";
import { WorkMapService } from "@/services/work-map.service";
import { WorkMapSourceCard } from "../source-card";
import { WorkMapSourcePicker } from "../source-picker";
import { RecoveryPanel } from "./recovery-panel";
import { PendingScenePanel } from "./pending-scene-panel";
import { allowPaste } from "./paste";
import { getNodeKey, isAllowedEmbedUrl } from "./scene";
import { getSourcePath } from "./source-navigation";
import { getCurrentInvalidatedNodeKeys } from "./source-invalidation";
import { useCollaboration } from "./use-collaboration";
import { useEmbeddableLoading } from "./use-embeddable-loading";
import { usePersistence } from "./use-persistence";
import { useScene } from "./use-scene";

const service = new WorkMapService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  workMap: TWorkMap;
};

export function WorkMapEditor({ workspaceSlug, projectId, workMap }: Props) {
  const router = useAppRouter();
  const store = useWorkMap();
  const { data: currentUser } = useUser();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingScene, setPendingScene] = useState<{
    elements: readonly OrderedExcalidrawElement[];
    files: BinaryFiles;
  } | null>(null);
  const changeSequenceRef = useRef(0);
  const context = useMemo(
    () => ({ workspaceSlug, projectId, workMapId: workMap.id }),
    [projectId, workMap.id, workspaceSlug]
  );
  const scene = useScene(api, context);
  const {
    initialData,
    initialLoadFailed,
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
  } = scene;
  const persistenceSceneOwners = useMemo(
    () => ({
      generationRef,
      durableSceneRef,
      getAppState: () => api?.getAppState(),
      applyStoredScene,
      applyAuthoritativeScene,
    }),
    [api, applyAuthoritativeScene, applyStoredScene, durableSceneRef, generationRef]
  );
  const persistence = usePersistence({ ...context, userId: currentUser?.id ?? "" }, persistenceSceneOwners);
  const { persistenceFailed, recoveryRecord, recoveryState, queue, evaluateRecovery, retryRecovery, discardRecovery } =
    persistence;
  const resynchronize = useCallback(async () => {
    const authoritative = await service.fetchScene(workspaceSlug, projectId, workMap.id);
    await applyAuthoritativeScene(authoritative);
  }, [applyAuthoritativeScene, projectId, workMap.id, workspaceSlug]);
  const failCloseSources = useCallback(() => store.invalidate(nodeKeys), [nodeKeys, store]);

  const hydrate = useCallback(
    async (keys = nodeKeys) => {
      if (keys.length === 0) return;
      try {
        await store.hydrate(workspaceSlug, projectId, workMap.id, keys.slice(0, 100));
      } catch {
        // Keep skeletons during a transport failure; authorization results still evict immediately.
      }
    },
    [nodeKeys, projectId, store, workMap.id, workspaceSlug]
  );

  const invalidateSources = useCallback(
    async (keys: string[]) => {
      const affected = getCurrentInvalidatedNodeKeys(nodeKeys, keys);
      if (affected.length === 0) return;
      store.invalidate(affected);
      await hydrate(affected);
    },
    [hydrate, nodeKeys, store]
  );

  const collaborationSceneOwners = useMemo(
    () => ({
      generationRef,
      resynchronize,
      applyRemoteScene,
      invalidateSources,
      failCloseSources,
    }),
    [applyRemoteScene, failCloseSources, generationRef, invalidateSources, resynchronize]
  );
  const onAuthorized = useCallback(
    (authorizedEditable: boolean) => evaluateRecovery(authorizedEditable && !workMap.is_locked && !workMap.archived_at),
    [evaluateRecovery, workMap.archived_at, workMap.is_locked]
  );
  const collaboration = useCollaboration(
    !!api && !!initialData && !!currentUser?.id,
    context,
    collaborationSceneOwners,
    onAuthorized,
    api
  );
  const {
    connectionState,
    relayEditable,
    sendScene,
    onPointerUpdate,
    collaboratorCount,
    collaboratorIds,
    pointerSenderIds,
    selectionSenderIds,
  } = collaboration;

  const documentEditable = !workMap.is_locked && !workMap.archived_at;
  const authorizedEditable = documentEditable && relayEditable && connectionState === "connected";
  const editable = authorizedEditable && !persistenceFailed && !pendingScene;
  const { shouldLoadEmbeddable, onEmbeddableLoadRequest } = useEmbeddableLoading(api, editable);

  const onPaste = useCallback(
    async (data: Parameters<NonNullable<ComponentProps<typeof Excalidraw>["onPaste"]>>[0]) => {
      try {
        return allowPaste(data, api?.getSceneElementsIncludingDeleted() ?? []);
      } catch {
        return false;
      }
    },
    [api]
  );

  useEffect(() => {
    void hydrate();
    const onFocus = () => void hydrate();
    const onOnline = () => void hydrate();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [connectionState, hydrate]);

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], _appState: AppState, files: BinaryFiles) => {
      observeElements(elements);
      if (!editable || isProgrammaticChange(elements)) return;
      const sequence = ++changeSequenceRef.current;
      void serializeScene(elements, files)
        .then((sceneBinary) => {
          if (sequence !== changeSequenceRef.current || sceneBinary === durableSceneRef.current) return undefined;
          sendScene(sceneBinary);
          queue(sceneBinary);
          return undefined;
        })
        .catch(() => setPendingScene({ elements, files }));
    },
    [durableSceneRef, editable, isProgrammaticChange, observeElements, queue, sendScene, serializeScene]
  );

  const retryPendingScene = useCallback(async () => {
    if (!pendingScene || !authorizedEditable) return;
    try {
      const sceneBinary = await serializeScene(pendingScene.elements, pendingScene.files);
      sendScene(sceneBinary);
      queue(sceneBinary);
      setPendingScene(null);
    } catch {
      // Keep the exact in-memory update frozen and available for another explicit retry.
    }
  }, [authorizedEditable, pendingScene, queue, sendScene, serializeScene]);

  const discardPendingScene = useCallback(async () => {
    try {
      await resynchronize();
      setPendingScene(null);
    } catch {
      // The failed local update stays frozen until the authoritative scene can be fetched.
    }
  }, [resynchronize]);

  useEffect(() => {
    if (!api || !editable) return;
    const interval = window.setInterval(() => {
      const elements = api.getSceneElementsIncludingDeleted();
      const files = api.getFiles();
      void serializeScene(elements, files)
        .then(sendScene)
        .catch(() => setPendingScene({ elements, files }));
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [api, editable, sendScene, serializeScene]);

  const openSource = useCallback(
    async (nodeKey: string) => {
      try {
        const response = await service.openSource(workspaceSlug, projectId, workMap.id, nodeKey);
        if (!response.available) {
          await hydrate([nodeKey]);
          return;
        }
        router.push(getSourcePath(workspaceSlug, response.action));
      } catch {
        // Authorization is resolved only by the open endpoint; a failed check must not navigate using cached projection data.
      }
    },
    [hydrate, projectId, router, workMap.id, workspaceSlug]
  );

  const renderEmbeddable = useCallback(
    (element: ExcalidrawEmbeddableElement) => {
      const nodeKey = getNodeKey(element);
      if (!nodeKey) return null;
      const projection = store.projections[nodeKey];
      return (
        <div
          data-testid="work-map-node"
          data-source-kind={
            projection ? (projection.available ? projection.source.source_kind : "unavailable") : "loading"
          }
          className="size-full overflow-hidden rounded-lg"
        >
          <WorkMapSourceCard projection={projection} onOpen={() => void openSource(nodeKey)} />
        </div>
      );
    },
    [openSource, store.projections]
  );

  const addSource = useCallback(
    async (source: TWorkMapSource) => {
      if (!api || !editable) return;
      try {
        const binding = await service.bindSource(workspaceSlug, projectId, workMap.id, source);
        const [base] = convertToExcalidrawElements([
          { type: "rectangle", x: 120, y: 120, width: 288, height: 132, backgroundColor: "transparent" },
        ]);
        const carrier = {
          ...base,
          type: "embeddable",
          link: `https://work-map.invalid/nodes/${binding.node_key}`,
          customData: { nodeKey: binding.node_key },
        } as ExcalidrawEmbeddableElement;
        api.updateScene({
          elements: [...api.getSceneElements(), carrier],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        setPickerOpen(false);
        await hydrate([binding.node_key]);
      } catch {
        // Binding creation is authoritative; a failed request must not insert an unbound carrier.
      }
    },
    [api, editable, hydrate, projectId, workMap.id, workspaceSlug]
  );

  const initialScene = useMemo(() => (initialData ? Promise.resolve(initialData) : undefined), [initialData]);
  const connectionDataState =
    persistenceFailed || pendingScene
      ? "persistence-failed"
      : !documentEditable || (connectionState === "connected" && !relayEditable)
        ? "read-only"
        : connectionState === "connecting"
          ? "disconnected"
          : connectionState;

  if (initialLoadFailed)
    return (
      <div className="grid size-full place-items-center text-13 text-danger-primary">
        Work Map could not load. Check your connection and retry.
      </div>
    );
  if (!initialScene)
    return <div className="grid size-full place-items-center text-13 text-secondary">Loading Work Map…</div>;

  return (
    <div
      data-testid="work-map-canvas"
      data-element-count={elementCount}
      data-live-node-count={liveNodeCount}
      className="relative size-full overflow-hidden bg-surface-1"
    >
      <div className="absolute top-3 left-3 z-10 flex gap-2">
        <button
          type="button"
          data-testid="work-map-add-source"
          disabled={!editable}
          className="rounded-md bg-accent-primary px-3 py-2 text-12 font-medium text-on-color disabled:opacity-50"
          onClick={() => setPickerOpen((open) => !open)}
        >
          Add Plane source
        </button>
        <button
          type="button"
          data-testid="work-map-add-embed"
          disabled={!editable}
          className="rounded-md border border-subtle bg-surface-1 px-3 py-2 text-12 font-medium disabled:opacity-50"
          onClick={() => api?.setActiveTool({ type: "embeddable" })}
        >
          Add URL embed
        </button>
        <span
          data-testid="work-map-connection-state"
          data-state={connectionDataState}
          className="rounded-md bg-surface-1 px-3 py-2 text-12 text-secondary"
        >
          {connectionDataState.replace("-", " ")}
        </span>
        {connectionDataState === "read-only" && (
          <span
            data-testid="work-map-read-only"
            className="rounded-md bg-warning-subtle px-3 py-2 text-12 text-warning-primary"
          >
            Read only
          </span>
        )}
      </div>
      <span
        data-testid="work-map-collaboration"
        data-state={collaboratorCount > 0 ? "active" : "empty"}
        data-collaborator-count={collaboratorCount}
        data-collaborator-ids={collaboratorIds}
        data-pointer-sender-ids={pointerSenderIds}
        data-selection-sender-ids={selectionSenderIds}
        className="sr-only"
      />
      {recoveryRecord && recoveryState && (
        <RecoveryPanel
          state={recoveryState}
          onRetry={() => void retryRecovery(authorizedEditable)}
          onDiscard={discardRecovery}
        />
      )}
      {pendingScene && (
        <PendingScenePanel onRetry={() => void retryPendingScene()} onDiscard={() => void discardPendingScene()} />
      )}
      {pickerOpen && (
        <WorkMapSourcePicker
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          workMapId={workMap.id}
          onSelect={(source) => void addSource(source)}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <div data-testid="work-map-embed" className="size-full">
        <Excalidraw
          onExcalidrawAPI={setApi}
          initialData={initialScene}
          onChange={onChange}
          onPointerUpdate={onPointerUpdate}
          onPaste={onPaste}
          isCollaborating={connectionState === "connected"}
          renderEmbeddable={renderEmbeddable}
          shouldLoadEmbeddable={shouldLoadEmbeddable}
          onEmbeddableLoadRequest={onEmbeddableLoadRequest}
          validateEmbeddable={(link) => link.startsWith("https://work-map.invalid/nodes/") || isAllowedEmbedUrl(link)}
          viewModeEnabled={!editable}
          UIOptions={{ canvasActions: { export: false, loadScene: false, saveToActiveFile: false } }}
        />
      </div>
    </div>
  );
}
