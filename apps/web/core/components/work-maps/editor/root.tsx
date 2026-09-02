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
import type { ComponentProps, CSSProperties, MouseEventHandler } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  convertToExcalidrawElements,
  sceneCoordsToViewportCoords,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { PointerDownState } from "@excalidraw/excalidraw/types";
// oxlint-disable-next-line import/no-unassigned-import -- Excalidraw owns its editor styles.
import "@excalidraw/excalidraw/index.css";
import type { TLanguage } from "@plane/i18n";
import { useTranslation } from "@plane/i18n";
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
import { getNodeKey } from "./scene";
import { getSourcePath } from "./source-navigation";
import { getCurrentInvalidatedNodeKeys } from "./source-invalidation";
import { useCollaboration } from "./use-collaboration";
import { isEmbeddableLinkAllowed } from "./embeddable-load";
import { useEmbeddableLoading } from "./use-embeddable-loading";
import { usePersistence } from "./use-persistence";
import type { TRecoveryState } from "./use-persistence";
import { useScene } from "./use-scene";
import { useWorkMapToolbarItems, WORK_MAP_TOOL_SHORTCUTS } from "./toolbar";
import { useTheme } from "next-themes";

const service = new WorkMapService();

const EXCALIDRAW_LOCALE_CODES: Record<TLanguage, NonNullable<ComponentProps<typeof Excalidraw>["langCode"]>> = {
  en: "en",
  fr: "fr-FR",
  es: "es-ES",
  ja: "ja-JP",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  ru: "ru-RU",
  it: "it-IT",
  cs: "cs-CZ",
  sk: "sk-SK",
  de: "de-DE",
  ua: "uk-UA",
  pl: "pl-PL",
  ko: "ko-KR",
  "pt-BR": "pt-BR",
  id: "id-ID",
  ro: "ro-RO",
  "tr-TR": "tr-TR",
  "vi-VN": "vi-VN",
};

const EXCALIDRAW_THEME_TOKENS = {
  "--color-primary": "var(--background-color-accent-primary)",
  "--color-primary-darker": "var(--background-color-accent-primary-hover)",
  "--color-primary-hover": "var(--background-color-accent-primary-hover)",
  "--color-primary-darkest": "var(--border-color-accent-strong)",
} as CSSProperties;

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
  const { resolvedTheme } = useTheme();
  const { currentLocale } = useTranslation();
  const store = useWorkMap();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [pickerSourceKind, setPickerSourceKind] = useState<TWorkMapSourceKind | null>(null);
  const [pendingSource, setPendingSource] = useState<TWorkMapSource | null>(null);
  const [placementPointer, setPlacementPointer] = useState<{ x: number; y: number; zoom: number } | null>(null);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [pendingScene, setPendingScene] = useState<{
    elements: readonly OrderedExcalidrawElement[];
    files: BinaryFiles;
  } | null>(null);
  const changeSequenceRef = useRef(0);
  const placingSourceRef = useRef(false);
  const selectedNodeKeyRef = useRef<string | null>(null);
  const pointerDownNodeKeyRef = useRef<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
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
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null;
      api?.setActiveTool({ type: "selection" });
      setPendingSource(null);
      setPickerSourceKind(sourceKind);
    },
    [api]
  );
  const returnFocus = useCallback(() => {
    queueMicrotask(() => returnFocusRef.current?.focus());
  }, []);
  const closeSourcePicker = useCallback(() => {
    setPickerSourceKind(null);
    returnFocus();
  }, [returnFocus]);
  const cancelSourceTool = useCallback(() => {
    setPickerSourceKind(null);
    setPendingSource(null);
    setPlacementPointer(null);
    api?.setActiveTool({ type: "selection" });
    returnFocus();
  }, [api, returnFocus]);
  const langCode = EXCALIDRAW_LOCALE_CODES[currentLocale];

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

  const handlePointerUpdate = useCallback(
    (payload: Parameters<NonNullable<ComponentProps<typeof Excalidraw>["onPointerUpdate"]>>[0]) => {
      onPointerUpdate(payload);
      if (!pendingSource || !api) return;
      const appState = api.getAppState();
      const viewport = sceneCoordsToViewportCoords({ sceneX: payload.pointer.x, sceneY: payload.pointer.y }, appState);
      setPlacementPointer({
        x: viewport.x - appState.offsetLeft,
        y: viewport.y - appState.offsetTop,
        zoom: appState.zoom.value,
      });
    },
    [api, onPointerUpdate, pendingSource]
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
    (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      observeElements(elements);
      const selectedIds = Object.keys(appState.selectedElementIds);
      const selectedElement =
        selectedIds.length === 1 ? elements.find((element) => element.id === selectedIds[0]) : undefined;
      const nextSelectedNodeKey =
        selectedElement && !selectedElement.isDeleted ? (getNodeKey(selectedElement) ?? null) : null;
      selectedNodeKeyRef.current = nextSelectedNodeKey;
      setSelectedNodeKey((current) => (current === nextSelectedNodeKey ? current : nextSelectedNodeKey));
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

  const openSelectedSource = useCallback(() => {
    const nodeKey = selectedNodeKeyRef.current;
    if (nodeKey) void openSource(nodeKey);
  }, [openSource]);

  const hostToolbarItems = useWorkMapToolbarItems({
    editable,
    sourceKind: pickerSourceKind ?? pendingSource?.source_kind ?? null,
    selectedNodeKey,
    onSelectSourceKind: selectSourceKind,
    onOpenSelectedSource: openSelectedSource,
    onCancelSourceTool: cancelSourceTool,
  });

  const renderHostElement = useCallback<NonNullable<ComponentProps<typeof Excalidraw>["renderHostElement"]>>(
    (element) => {
      const nodeKey = getNodeKey(element);
      return nodeKey ? <WorkMapSourceNode nodeKey={nodeKey} /> : null;
    },
    []
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
        const carrier = { ...base, customData: { nodeKey: binding.node_key } };
        api.updateScene({
          elements: [...api.getSceneElements(), carrier],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        setPendingSource(null);
        setPlacementPointer(null);
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
      pointerDownNodeKeyRef.current = getNodeKey(pointerDownState.hit.element);
      if (activeTool.type !== "custom" || activeTool.customType !== "work-map-source" || !pendingSource) return;
      void placeSource(pendingSource, pointerDownState.origin);
    },
    [pendingSource, placeSource]
  );

  const onDoubleClick = useCallback(() => {
    const nodeKey = pointerDownNodeKeyRef.current;
    if (nodeKey) void openSource(nodeKey);
  }, [openSource]);

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
      recoveryRecord={recoveryRecord}
      recoveryState={recoveryState}
      pendingScene={!!pendingScene}
      elementCount={elementCount}
      liveNodeCount={liveNodeCount}
      collaboratorCount={collaboratorCount}
      collaboratorIds={collaboratorIds}
      pointerSenderIds={pointerSenderIds}
      selectionSenderIds={selectionSenderIds}
      onRetryRecovery={() => void retryRecovery(authorizedEditable)}
      onDiscardRecovery={discardRecovery}
      onRetryPending={() => void retryPendingScene()}
      onDiscardPending={() => void discardPendingScene()}
      onSelectSource={beginSourcePlacement}
      onClosePicker={closeSourcePicker}
      onExcalidrawAPI={setApi}
      onChange={onChange}
      onPointerUpdate={handlePointerUpdate}
      placementPointer={placementPointer}
      pendingSourceName={pendingSource?.name ?? null}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onPaste={onPaste}
      renderHostElement={renderHostElement}
      shouldLoadEmbeddable={shouldLoadEmbeddable}
      onEmbeddableLoadRequest={onEmbeddableLoadRequest}
      hostToolbarItems={hostToolbarItems}
      toolShortcutOverrides={WORK_MAP_TOOL_SHORTCUTS}
      langCode={langCode}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
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
  recoveryRecord: unknown;
  recoveryState: TRecoveryState | null;
  pendingScene: boolean;
  elementCount: number;
  liveNodeCount: number;
  collaboratorCount: number;
  collaboratorIds: string;
  pointerSenderIds: string;
  selectionSenderIds: string;
  onRetryRecovery: () => void;
  onDiscardRecovery: () => void;
  onRetryPending: () => void;
  onDiscardPending: () => void;
  onSelectSource: (source: TWorkMapSource) => void;
  onClosePicker: () => void;
  onExcalidrawAPI: (api: ExcalidrawImperativeAPI) => void;
  onChange: NonNullable<ComponentProps<typeof Excalidraw>["onChange"]>;
  onPointerUpdate: NonNullable<ComponentProps<typeof Excalidraw>["onPointerUpdate"]>;
  onDoubleClick: MouseEventHandler<HTMLDivElement>;
  placementPointer: { x: number; y: number; zoom: number } | null;
  pendingSourceName: string | null;
  onPointerDown: NonNullable<ComponentProps<typeof Excalidraw>["onPointerDown"]>;
  onPaste: NonNullable<ComponentProps<typeof Excalidraw>["onPaste"]>;
  renderHostElement: NonNullable<ComponentProps<typeof Excalidraw>["renderHostElement"]>;
  shouldLoadEmbeddable: NonNullable<ComponentProps<typeof Excalidraw>["shouldLoadEmbeddable"]>;
  onEmbeddableLoadRequest: NonNullable<ComponentProps<typeof Excalidraw>["onEmbeddableLoadRequest"]>;
  hostToolbarItems: NonNullable<ComponentProps<typeof Excalidraw>["hostToolbarItems"]>;
  toolShortcutOverrides: NonNullable<ComponentProps<typeof Excalidraw>["toolShortcutOverrides"]>;
  langCode: NonNullable<ComponentProps<typeof Excalidraw>["langCode"]>;
  theme: "light" | "dark";
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
  recoveryRecord,
  recoveryState,
  pendingScene,
  elementCount,
  liveNodeCount,
  collaboratorCount,
  collaboratorIds,
  pointerSenderIds,
  selectionSenderIds,
  onRetryRecovery,
  onDiscardRecovery,
  onRetryPending,
  onDiscardPending,
  onSelectSource,
  onClosePicker,
  onExcalidrawAPI,
  onChange,
  onPointerUpdate,
  onDoubleClick,
  placementPointer,
  pendingSourceName,
  onPointerDown,
  onPaste,
  renderHostElement,
  shouldLoadEmbeddable,
  onEmbeddableLoadRequest,
  hostToolbarItems,
  toolShortcutOverrides,
  langCode,
  theme,
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
      {placementPointer && pendingSourceName && (
        <div
          data-testid="work-map-placement-ghost"
          aria-hidden="true"
          className="border-accent-primary pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-dashed bg-accent-primary/10"
          style={{
            left: placementPointer.x,
            top: placementPointer.y,
            width: 288 * placementPointer.zoom,
            height: 132 * placementPointer.zoom,
          }}
        >
          <span className="sr-only">{pendingSourceName}</span>
        </div>
      )}
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
      <div
        data-testid="work-map-embed"
        className="size-full"
        style={EXCALIDRAW_THEME_TOKENS}
        onDoubleClick={onDoubleClick}
      >
        <Excalidraw
          renderHostElement={renderHostElement}
          onExcalidrawAPI={onExcalidrawAPI}
          initialData={initialScene}
          onChange={onChange}
          onPointerUpdate={onPointerUpdate}
          onPointerDown={onPointerDown}
          onPaste={onPaste}
          isCollaborating={connectionState === "connected"}
          shouldLoadEmbeddable={shouldLoadEmbeddable}
          onEmbeddableLoadRequest={onEmbeddableLoadRequest}
          validateEmbeddable={isEmbeddableLinkAllowed}
          viewModeEnabled={!editable}
          hostToolbarItems={hostToolbarItems}
          toolShortcutOverrides={toolShortcutOverrides}
          langCode={langCode}
          theme={theme}
          aiEnabled={false}
          UIOptions={{
            canvasActions: { export: false, loadScene: false, saveToActiveFile: false },
            socialLinks: false,
          }}
        />
      </div>
    </div>
  );
}
