/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { CaptureUpdateAction, Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  ExcalidrawEmbeddableElement,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { PointerDownState } from "@excalidraw/excalidraw/types";
// oxlint-disable-next-line import/no-unassigned-import -- Excalidraw owns its editor styles.
import "@excalidraw/excalidraw/index.css";
import type { TWorkMap, TWorkMapSource, TWorkMapSourceKind } from "@plane/types";
import { useAppRouter } from "@/hooks/use-app-router";
import { useWorkMap } from "@/hooks/store/use-work-map";
import { useUser } from "@/hooks/store/user";
import { WorkMapService } from "@/services/work-map.service";
import { WorkMapSourceNode } from "../source-node";
import { WorkMapSourcePicker } from "../source-picker";
import { RecoveryPanel } from "./recovery-panel";
import { PendingScenePanel } from "./pending-scene-panel";
import { rebindProtectedPaste } from "./paste";
import { createNodeCarrierLink, getNodeKey } from "./scene";
import { getSourcePath } from "./source-navigation";
import { getCurrentInvalidatedNodeKeys } from "./source-invalidation";
import { useCollaboration } from "./use-collaboration";
import { isEmbeddableLinkAllowed } from "./embeddable-load";
import { useEmbeddableLoading } from "./use-embeddable-loading";
import { usePersistence } from "./use-persistence";
import type { TRecoveryState } from "./use-persistence";
import { useScene } from "./use-scene";
import { WorkMapToolbar, useWorkMapToolShortcuts } from "./toolbar";

const service = new WorkMapService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  workMap: TWorkMap;
};

export function WorkMapEditor({ workspaceSlug, projectId, workMap }: Props) {
  const { data: currentUser } = useUser();
  return (
    <WorkMapEditorContent
      key={`${workspaceSlug}:${projectId}:${workMap.id}:${currentUser?.id ?? "anonymous"}`}
      workspaceSlug={workspaceSlug}
      projectId={projectId}
      workMap={workMap}
      userId={currentUser?.id ?? ""}
    />
  );
}

type EditorContentProps = Props & { userId: string };

function WorkMapEditorContent({ workspaceSlug, projectId, workMap, userId }: EditorContentProps) {
  const router = useAppRouter();
  const store = useWorkMap();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [pickerSourceKind, setPickerSourceKind] = useState<TWorkMapSourceKind | null>(null);
  const [pendingSource, setPendingSource] = useState<TWorkMapSource | null>(null);
  const [pendingScene, setPendingScene] = useState<{
    elements: readonly OrderedExcalidrawElement[];
    files: BinaryFiles;
  } | null>(null);
  const changeSequenceRef = useRef(0);
  const placingSourceRef = useRef(false);
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
  const nodeKeysRef = useRef(nodeKeys);
  useEffect(() => {
    nodeKeysRef.current = nodeKeys;
  }, [nodeKeys]);
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
  const persistence = usePersistence({ ...context, userId }, persistenceSceneOwners);
  const { persistenceFailed, recoveryRecord, recoveryState, queue, evaluateRecovery, retryRecovery, discardRecovery } =
    persistence;
  const resynchronize = useCallback(async () => {
    const authoritative = await service.fetchScene(workspaceSlug, projectId, workMap.id);
    await applyAuthoritativeScene(authoritative);
  }, [applyAuthoritativeScene, projectId, workMap.id, workspaceSlug]);
  const failCloseSources = useCallback(() => store.invalidate(nodeKeysRef.current), [store]);

  const hydrate = useCallback(
    async (keys = nodeKeysRef.current) => {
      if (keys.length === 0) return;
      try {
        await store.hydrate(workspaceSlug, projectId, workMap.id, keys.slice(0, 100));
      } catch {
        // Keep skeletons during a transport failure; authorization results still evict immediately.
      }
    },
    [projectId, store, workMap.id, workspaceSlug]
  );

  const invalidateSources = useCallback(
    async (keys: string[]) => {
      const affected = getCurrentInvalidatedNodeKeys(nodeKeysRef.current, keys);
      if (affected.length === 0) return;
      store.invalidate(affected);
      await hydrate(affected);
    },
    [hydrate, store]
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
    !!api && !!initialData && !!userId,
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

  const selectSourceKind = useCallback(
    (sourceKind: TWorkMapSourceKind) => {
      api?.setActiveTool({ type: "selection" });
      setPendingSource(null);
      setPickerSourceKind(sourceKind);
    },
    [api]
  );
  const closeSourcePicker = useCallback(() => setPickerSourceKind(null), []);
  const cancelSourceTool = useCallback(() => {
    setPickerSourceKind(null);
    setPendingSource(null);
    api?.setActiveTool({ type: "selection" });
  }, [api]);
  useWorkMapToolShortcuts(api, editable, !!pickerSourceKind || !!pendingSource, selectSourceKind, cancelSourceTool);

  const onPaste = useCallback(
    async (data: Parameters<NonNullable<ComponentProps<typeof Excalidraw>["onPaste"]>>[0]) => {
      try {
        return rebindProtectedPaste(data, api?.getSceneElementsIncludingDeleted() ?? [], async (sourceNodeKeys) => {
          const result = await service.rebindPaste(
            workspaceSlug,
            projectId,
            workMap.id,
            generationRef.current,
            sourceNodeKeys
          );
          return result.node_keys;
        });
      } catch {
        return false;
      }
    },
    [api, generationRef, projectId, workMap.id, workspaceSlug]
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
      return <WorkMapSourceNode nodeKey={nodeKey} onOpen={() => void openSource(nodeKey)} />;
    },
    [openSource]
  );

  const placeSource = useCallback(
    async (source: TWorkMapSource, origin: PointerDownState["origin"]) => {
      if (!api || !editable || placingSourceRef.current) return;
      placingSourceRef.current = true;
      try {
        const binding = await service.bindSource(workspaceSlug, projectId, workMap.id, source);
        const [base] = convertToExcalidrawElements([
          {
            type: "rectangle",
            x: origin.x - 144,
            y: origin.y - 66,
            width: 288,
            height: 132,
            backgroundColor: "transparent",
          },
        ]);
        const carrier = {
          ...base,
          type: "embeddable",
          link: createNodeCarrierLink(binding.node_key),
          customData: { nodeKey: binding.node_key },
        } as ExcalidrawEmbeddableElement;
        api.updateScene({
          elements: [...api.getSceneElements(), carrier],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        setPendingSource(null);
        api.setActiveTool({ type: "selection" });
        await hydrate([binding.node_key]);
      } catch {
        // Binding creation is authoritative; a failed request must not insert an unbound carrier.
      } finally {
        placingSourceRef.current = false;
      }
    },
    [api, editable, hydrate, projectId, workMap.id, workspaceSlug]
  );

  const beginSourcePlacement = useCallback(
    (source: TWorkMapSource) => {
      if (!api || !editable) return;
      setPickerSourceKind(null);
      setPendingSource(source);
      api.setActiveTool({ type: "custom", customType: "work-map-source" });
    },
    [api, editable]
  );

  const onPointerDown = useCallback(
    (activeTool: AppState["activeTool"], pointerDownState: PointerDownState) => {
      if (activeTool.type !== "custom" || activeTool.customType !== "work-map-source" || !pendingSource) return;
      void placeSource(pendingSource, pointerDownState.origin);
    },
    [pendingSource, placeSource]
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
      <div className="grid size-full place-items-center gap-2 text-13 text-danger-primary">
        <p>Work Map could not load. Check your connection and retry.</p>
        <button type="button" className="rounded border border-subtle px-3 py-1.5" onClick={scene.retryInitialLoad}>
          Retry
        </button>
      </div>
    );
  if (!initialScene)
    return <div className="grid size-full place-items-center text-13 text-secondary">Loading Work Map…</div>;

  return (
    <WorkMapEditorSurface
      workspaceSlug={workspaceSlug}
      projectId={projectId}
      workMapId={workMap.id}
      initialScene={initialScene}
      editable={editable}
      connectionState={connectionState}
      connectionDataState={connectionDataState}
      pickerSourceKind={pickerSourceKind}
      activeSourceKind={pickerSourceKind ?? pendingSource?.source_kind ?? null}
      recoveryRecord={recoveryRecord}
      recoveryState={recoveryState}
      pendingScene={!!pendingScene}
      elementCount={elementCount}
      liveNodeCount={liveNodeCount}
      collaboratorCount={collaboratorCount}
      collaboratorIds={collaboratorIds}
      pointerSenderIds={pointerSenderIds}
      selectionSenderIds={selectionSenderIds}
      onSelectSourceKind={selectSourceKind}
      onRetryRecovery={() => void retryRecovery(authorizedEditable)}
      onDiscardRecovery={discardRecovery}
      onRetryPending={() => void retryPendingScene()}
      onDiscardPending={() => void discardPendingScene()}
      onSelectSource={beginSourcePlacement}
      onClosePicker={closeSourcePicker}
      onExcalidrawAPI={setApi}
      onChange={onChange}
      onPointerUpdate={onPointerUpdate}
      onPointerDown={onPointerDown}
      onPaste={onPaste}
      renderEmbeddable={renderEmbeddable}
      shouldLoadEmbeddable={shouldLoadEmbeddable}
      onEmbeddableLoadRequest={onEmbeddableLoadRequest}
    />
  );
}

type EditorSurfaceProps = {
  workspaceSlug: string;
  projectId: string;
  workMapId: string;
  initialScene: Promise<{ elements: readonly ExcalidrawElement[]; files: BinaryFiles }>;
  editable: boolean;
  connectionState: string;
  connectionDataState: string;
  pickerSourceKind: TWorkMapSourceKind | null;
  activeSourceKind: TWorkMapSourceKind | null;
  recoveryRecord: unknown;
  recoveryState: TRecoveryState | null;
  pendingScene: boolean;
  elementCount: number;
  liveNodeCount: number;
  collaboratorCount: number;
  collaboratorIds: string;
  pointerSenderIds: string;
  selectionSenderIds: string;
  onSelectSourceKind: (sourceKind: TWorkMapSourceKind) => void;
  onRetryRecovery: () => void;
  onDiscardRecovery: () => void;
  onRetryPending: () => void;
  onDiscardPending: () => void;
  onSelectSource: (source: TWorkMapSource) => void;
  onClosePicker: () => void;
  onExcalidrawAPI: (api: ExcalidrawImperativeAPI) => void;
  onChange: NonNullable<ComponentProps<typeof Excalidraw>["onChange"]>;
  onPointerUpdate: NonNullable<ComponentProps<typeof Excalidraw>["onPointerUpdate"]>;
  onPointerDown: NonNullable<ComponentProps<typeof Excalidraw>["onPointerDown"]>;
  onPaste: NonNullable<ComponentProps<typeof Excalidraw>["onPaste"]>;
  renderEmbeddable: NonNullable<ComponentProps<typeof Excalidraw>["renderEmbeddable"]>;
  shouldLoadEmbeddable: NonNullable<ComponentProps<typeof Excalidraw>["shouldLoadEmbeddable"]>;
  onEmbeddableLoadRequest: NonNullable<ComponentProps<typeof Excalidraw>["onEmbeddableLoadRequest"]>;
};

function WorkMapEditorSurface({
  workspaceSlug,
  projectId,
  workMapId,
  initialScene,
  editable,
  connectionState,
  connectionDataState,
  pickerSourceKind,
  activeSourceKind,
  recoveryRecord,
  recoveryState,
  pendingScene,
  elementCount,
  liveNodeCount,
  collaboratorCount,
  collaboratorIds,
  pointerSenderIds,
  selectionSenderIds,
  onSelectSourceKind,
  onRetryRecovery,
  onDiscardRecovery,
  onRetryPending,
  onDiscardPending,
  onSelectSource,
  onClosePicker,
  onExcalidrawAPI,
  onChange,
  onPointerUpdate,
  onPointerDown,
  onPaste,
  renderEmbeddable,
  shouldLoadEmbeddable,
  onEmbeddableLoadRequest,
}: EditorSurfaceProps) {
  return (
    <div
      data-testid="work-map-canvas"
      data-element-count={elementCount}
      data-live-node-count={liveNodeCount}
      className="relative size-full overflow-hidden bg-surface-1"
    >
      <span data-testid="work-map-connection-state" data-state={connectionDataState} className="sr-only">
        {connectionDataState.replace("-", " ")}
      </span>
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
        <RecoveryPanel state={recoveryState} onRetry={onRetryRecovery} onDiscard={onDiscardRecovery} />
      )}
      {pendingScene && <PendingScenePanel onRetry={onRetryPending} onDiscard={onDiscardPending} />}
      {pickerSourceKind && (
        <WorkMapSourcePicker
          key={pickerSourceKind}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          workMapId={workMapId}
          initialSourceKind={pickerSourceKind}
          onSelect={onSelectSource}
          onClose={onClosePicker}
        />
      )}
      <div data-testid="work-map-embed" className="size-full">
        <Excalidraw
          onExcalidrawAPI={onExcalidrawAPI}
          initialData={initialScene}
          onChange={onChange}
          onPointerUpdate={onPointerUpdate}
          onPointerDown={onPointerDown}
          onPaste={onPaste}
          isCollaborating={connectionState === "connected"}
          renderEmbeddable={renderEmbeddable}
          shouldLoadEmbeddable={shouldLoadEmbeddable}
          onEmbeddableLoadRequest={onEmbeddableLoadRequest}
          validateEmbeddable={isEmbeddableLinkAllowed}
          viewModeEnabled={!editable}
          renderToolbarUI={() => (
            <WorkMapToolbar editable={editable} sourceKind={activeSourceKind} onSelectSourceKind={onSelectSourceKind} />
          )}
          UIOptions={{ canvasActions: { export: false, loadScene: false, saveToActiveFile: false } }}
        />
      </div>
    </div>
  );
}
