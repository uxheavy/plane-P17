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
import { observer } from "mobx-react";
import type { ComponentProps, MouseEventHandler } from "react";
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
// oxlint-disable-next-line import/no-unassigned-import -- Plane supplies tokens to the native editor UI.
import "./theme.css";
import type { TLanguage } from "@plane/i18n";
import { useTranslation } from "@plane/i18n";
import type { TWorkMap, TWorkMapSource, TWorkMapSourceKind } from "@plane/types";
import { Avatar } from "@plane/ui";
import { resolveGeneralTheme } from "@plane/utils";
import { useAppRouter } from "@/hooks/use-app-router";
import { useWorkMap } from "@/hooks/store/use-work-map";
import { useUser, useUserProfile } from "@/hooks/store/user";
import { WorkMapService } from "@/services/work-map.service";
import { UpdateStatus } from "@/components/common/update-status";
import { WorkMapSourceNode } from "../source-node";
import { WorkMapSourcePicker } from "../source-picker";
import { WorkMapWorkItemPicker } from "../work-item-picker";
import type { WorkMapPlacementSource, WorkMapWorkItemAction } from "../work-item-picker";
import { RecoveryPanel } from "./recovery-panel";
import { rebindProtectedPaste } from "./paste";
import {
  getNodeKey,
  getWorkMapFileMetadata,
  isGenerationConflict,
  isSceneSerializationCancelled,
  isTransientPersistenceFailure,
  normalizeNodeCarrier,
  type TSceneAuthority,
  type TWorkMapRuntimeFile,
} from "./scene";
import { getSourcePath } from "./source-navigation";
import { getCurrentInvalidatedNodeKeys } from "./source-invalidation";
import { useCollaboration } from "./use-collaboration";
import { isEmbeddableLinkAllowed } from "./embeddable-load";
import { useEmbeddableLoading } from "./use-embeddable-loading";
import { usePersistence } from "./use-persistence";
import type { TPersistenceStatus, TRecoveryEntry } from "./use-persistence";
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

const WorkMapEditorContent = observer(function WorkMapEditorContent({
  workspaceSlug,
  projectId,
  workMap,
  userId,
}: EditorContentProps) {
  const router = useAppRouter();
  const { resolvedTheme } = useTheme();
  const { data: userProfile } = useUserProfile();
  const isDarkTheme =
    resolvedTheme === "custom"
      ? Boolean(userProfile?.theme?.darkPalette)
      : resolveGeneralTheme(resolvedTheme) === "dark";
  const { currentLocale } = useTranslation();
  const store = useWorkMap();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [pickerSourceKind, setPickerSourceKind] = useState<TWorkMapSourceKind | null>(null);
  const [workItemAction, setWorkItemAction] = useState<WorkMapWorkItemAction>("existing");
  const [pendingSources, setPendingSources] = useState<WorkMapPlacementSource[]>([]);
  const pendingSource = pendingSources[0] ?? null;
  useEffect(() => {
    if (!pendingSource) api?.setActiveTool({ type: "selection" });
  }, [api, pendingSource]);
  const [placementPointer, setPlacementPointer] = useState<{ x: number; y: number; zoom: number } | null>(null);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const lastKnownPermissionRef = useRef(false);
  const [pendingScene, setPendingScene] = useState<{
    elements: readonly OrderedExcalidrawElement[];
    files: BinaryFiles;
    authority: TSceneAuthority;
    blocking: boolean;
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
    collaborationEpochRef,
    durableSceneRef,
    observeElements,
    isProgrammaticChange,
    registerPastedFiles,
    serializeScene,
    uploadsInProgress,
    cancelUploads,
    applyAuthoritativeScene,
    applyRemoteScene,
  } = scene;
  const nodeKeysRef = useRef(nodeKeys);
  useEffect(() => {
    nodeKeysRef.current = nodeKeys;
  }, [nodeKeys]);
  const persistenceSceneOwners = useMemo(
    () => ({
      generationRef,
      collaborationEpochRef,
      durableSceneRef,
      getAppState: () => api?.getAppState(),
      applyRemoteScene,
      applyAuthoritativeScene,
    }),
    [api, applyAuthoritativeScene, applyRemoteScene, collaborationEpochRef, durableSceneRef, generationRef]
  );
  const persistence = usePersistence({ ...context, userId }, persistenceSceneOwners);
  const {
    persistenceFailed,
    recoveryStorageFailed,
    recoveryEntries,
    queue,
    evaluateRecovery,
    discardRecovery,
    retryRecoveryStorage,
    hasPendingDraft,
    resumePendingDraft,
  } = persistence;
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
      hasPendingDraft,
      resumePendingDraft,
      applyRemoteScene,
      invalidateSources,
      failCloseSources,
    }),
    [
      applyRemoteScene,
      failCloseSources,
      generationRef,
      hasPendingDraft,
      invalidateSources,
      resynchronize,
      resumePendingDraft,
    ]
  );
  const documentEditable = !workMap.is_locked && !workMap.archived_at;
  const onAuthorized = useCallback(
    (authorizedEditable: boolean) => {
      const canEdit = authorizedEditable && documentEditable;
      lastKnownPermissionRef.current = canEdit;
      if (!canEdit) cancelUploads();
      evaluateRecovery(canEdit);
    },
    [cancelUploads, documentEditable, evaluateRecovery]
  );
  const collaboration = useCollaboration(
    !!api && !!initialData && !!userId,
    context,
    collaborationSceneOwners,
    onAuthorized,
    api,
    userId
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

  const broadcastReady = connectionState === "connected" && relayEditable;
  const canvasEditable =
    documentEditable && lastKnownPermissionRef.current && !persistenceFailed && !(pendingScene?.blocking ?? false);
  const serverMutationAllowed = canvasEditable && broadcastReady;
  const { shouldLoadEmbeddable, onEmbeddableLoadRequest } = useEmbeddableLoading(api, canvasEditable);

  const selectSourceKind = useCallback(
    (sourceKind: TWorkMapSourceKind) => {
      if (!serverMutationAllowed) return;
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null;
      api?.setActiveTool({ type: "selection" });
      setPendingSources([]);
      setPickerSourceKind(sourceKind);
    },
    [api, serverMutationAllowed]
  );
  const selectWorkItemAction = useCallback(
    (action: WorkMapWorkItemAction) => {
      setWorkItemAction(action);
      selectSourceKind("work-item");
    },
    [selectSourceKind]
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
    setPendingSources([]);
    setPlacementPointer(null);
    api?.setActiveTool({ type: "selection" });
    returnFocus();
  }, [api, returnFocus]);
  const langCode = EXCALIDRAW_LOCALE_CODES[currentLocale];

  const onPaste = useCallback(
    async (data: Parameters<NonNullable<ComponentProps<typeof Excalidraw>["onPaste"]>>[0]) => {
      const hasUnownedFiles = Object.values(data.files ?? {}).some(
        (file) => !getWorkMapFileMetadata(file as TWorkMapRuntimeFile)
      );
      if (!serverMutationAllowed && hasUnownedFiles) return false;
      try {
        const rebound = await rebindProtectedPaste(
          data,
          api?.getSceneElementsIncludingDeleted() ?? [],
          (sourceNodeKeys, sourceFiles) => {
            if (!serverMutationAllowed) throw new Error("Work map paste rebinding is unavailable offline");
            return service.rebindPaste(
              workspaceSlug,
              projectId,
              workMap.id,
              generationRef.current,
              sourceNodeKeys,
              Object.entries(sourceFiles).map(([fileId, file]) => ({ file_id: fileId, asset_id: file.assetId }))
            );
          },
          api?.getFiles() ?? {}
        );
        if (rebound !== false && rebound.files) {
          registerPastedFiles(
            Object.fromEntries(
              Object.entries(rebound.files).flatMap(([fileId, file]) => {
                const metadata = getWorkMapFileMetadata(file as TWorkMapRuntimeFile);
                return metadata ? [[fileId, metadata]] : [];
              })
            )
          );
        }
        return rebound;
      } catch {
        return false;
      }
    },
    [api, generationRef, projectId, registerPastedFiles, serverMutationAllowed, workMap.id, workspaceSlug]
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
    void hydrate(nodeKeys);
    const onFocus = () => void hydrate();
    const onOnline = () => void hydrate();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [connectionState, hydrate, nodeKeys]);

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
      if (!canvasEditable || isProgrammaticChange(elements)) return;
      const sequence = ++changeSequenceRef.current;
      const authority: TSceneAuthority = {
        generation: generationRef.current,
        collaboration_epoch: collaborationEpochRef.current,
      };
      void serializeScene(elements, files)
        .then((sceneBinary) => {
          if (sequence !== changeSequenceRef.current) return undefined;
          if (sceneBinary === durableSceneRef.current) {
            setPendingScene(null);
            return undefined;
          }
          const outcome = queue(sceneBinary, authority);
          if (outcome === "queued") sendScene(sceneBinary);
          if (outcome === "blocked") setPendingScene({ elements, files, authority, blocking: true });
          else setPendingScene(null);
          return undefined;
        })
        .catch((error) => {
          if (sequence === changeSequenceRef.current && !isSceneSerializationCancelled(error))
            setPendingScene({ elements, files, authority, blocking: !isTransientPersistenceFailure(error) });
        });
    },
    [
      collaborationEpochRef,
      durableSceneRef,
      canvasEditable,
      generationRef,
      isProgrammaticChange,
      observeElements,
      queue,
      sendScene,
      serializeScene,
    ]
  );

  const retryPendingScene = useCallback(async () => {
    if (!pendingScene || !broadcastReady) return;
    const sequence = changeSequenceRef.current;
    try {
      const sceneBinary = await serializeScene(pendingScene.elements, pendingScene.files);
      if (sequence !== changeSequenceRef.current) return;
      const outcome = queue(sceneBinary, pendingScene.authority);
      if (outcome === "blocked") {
        setPendingScene((current) =>
          current === pendingScene && !current.blocking ? { ...current, blocking: true } : current
        );
        return;
      }
      if (outcome === "queued") sendScene(sceneBinary);
      setPendingScene((current) => (current === pendingScene ? null : current));
    } catch (error) {
      setPendingScene((current) => {
        if (current !== pendingScene) return current;
        if (isSceneSerializationCancelled(error)) return current;
        const blocking = !isTransientPersistenceFailure(error);
        return current.blocking === blocking ? current : { ...current, blocking };
      });
    }
  }, [broadcastReady, pendingScene, queue, sendScene, serializeScene]);

  const discardPendingScene = useCallback(async () => {
    try {
      await resynchronize();
      setPendingScene(null);
    } catch {
      // The failed local update stays frozen until the authoritative scene can be fetched.
    }
  }, [resynchronize]);

  useEffect(() => {
    if (!api || !canvasEditable) return;
    const interval = window.setInterval(() => {
      const elements = api.getSceneElementsIncludingDeleted();
      const files = api.getFiles();
      const sequence = ++changeSequenceRef.current;
      const authority: TSceneAuthority = {
        generation: generationRef.current,
        collaboration_epoch: collaborationEpochRef.current,
      };
      void serializeScene(elements, files)
        .then((sceneBinary) => {
          if (sequence !== changeSequenceRef.current) return undefined;
          if (authority.collaboration_epoch === collaborationEpochRef.current) sendScene(sceneBinary);
          return undefined;
        })
        .catch((error) => {
          if (sequence === changeSequenceRef.current)
            if (!isSceneSerializationCancelled(error))
              setPendingScene({ elements, files, authority, blocking: !isTransientPersistenceFailure(error) });
        });
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [api, canvasEditable, collaborationEpochRef, generationRef, sendScene, serializeScene]);

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
    editable: serverMutationAllowed,
    sourceKind: pickerSourceKind ?? pendingSource?.source_kind ?? null,
    selectedNodeKey,
    onSelectSourceKind: selectSourceKind,
    onSelectWorkItemAction: selectWorkItemAction,
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
  const renderCollaboratorAvatar = useCallback<
    NonNullable<ComponentProps<typeof Excalidraw>["renderCollaboratorAvatar"]>
  >(({ name, src, size }) => <Avatar name={name} src={src} size={size} shape="circle" showTooltip={false} />, []);

  const placeSource = useCallback(
    async (source: WorkMapPlacementSource, origin: PointerDownState["origin"]) => {
      if (!api || !serverMutationAllowed || placingSourceRef.current) return;
      placingSourceRef.current = true;
      try {
        const placementId = crypto.randomUUID();
        let binding: Awaited<ReturnType<typeof service.bindSource>> | undefined;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            binding = await service.bindSource(
              workspaceSlug,
              projectId,
              workMap.id,
              generationRef.current,
              placementId,
              source
            );
            break;
          } catch (error) {
            if (!isGenerationConflict(error) || attempt === 2) throw error;
            const responseGeneration =
              error && typeof error === "object" && "response" in error
                ? (error.response as { data?: { generation?: unknown } } | undefined)?.data?.generation
                : undefined;
            if (typeof responseGeneration !== "number" || !Number.isInteger(responseGeneration)) throw error;
            generationRef.current = responseGeneration;
          }
        }
        if (!binding) return;
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
        const carrier = normalizeNodeCarrier({
          ...base,
          customData: { nodeKey: binding.node_key },
        });
        api.updateScene({
          elements: [...api.getSceneElements(), carrier],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        setPendingSources((current) => (current[0] === source ? current.slice(1) : current));
        setPlacementPointer(null);
        await hydrate([binding.node_key]);
      } catch {
        // Binding creation is authoritative; a failed request must not insert an unbound carrier.
      } finally {
        placingSourceRef.current = false;
      }
    },
    [api, generationRef, hydrate, projectId, serverMutationAllowed, workMap.id, workspaceSlug]
  );

  const beginSourcePlacement = useCallback(
    (sources: WorkMapPlacementSource[]) => {
      if (!api || !serverMutationAllowed || sources.length === 0) return;
      setPickerSourceKind(null);
      setPendingSources(sources);
    },
    [api, serverMutationAllowed]
  );

  const onPointerDown = useCallback(
    (activeTool: AppState["activeTool"], pointerDownState: PointerDownState) => {
      pointerDownNodeKeyRef.current = pointerDownState.hit.element
        ? (getNodeKey(pointerDownState.hit.element) ?? null)
        : null;
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
    persistenceFailed || pendingScene?.blocking
      ? "persistence-failed"
      : !documentEditable || (connectionState === "connected" && !relayEditable)
        ? "read-only"
        : connectionState === "connecting"
          ? "disconnected"
          : connectionState;

  if (initialLoadFailed)
    return (
      <div className="grid size-full place-items-center gap-2 text-13 text-danger-primary">
        <p>Work map could not load. Check your connection and retry.</p>
        <button type="button" className="rounded border border-subtle px-3 py-1.5" onClick={scene.retryInitialLoad}>
          Retry
        </button>
      </div>
    );
  if (!initialScene || !initialData)
    return <div className="grid size-full place-items-center text-13 text-secondary">Loading Work map…</div>;

  return (
    <WorkMapEditorSurface
      workspaceSlug={workspaceSlug}
      projectId={projectId}
      workMapId={workMap.id}
      initialScene={initialScene}
      initialElements={initialData.elements}
      editable={canvasEditable}
      serverMutationAllowed={serverMutationAllowed}
      connectionState={connectionState}
      connectionDataState={connectionDataState}
      persistenceStatus={persistence.persistenceStatus}
      pickerSourceKind={pickerSourceKind}
      workItemAction={workItemAction}
      recoveryEntries={recoveryEntries}
      recoveryStorageFailed={recoveryStorageFailed}
      pendingScene={Boolean(pendingScene)}
      elementCount={elementCount}
      liveNodeCount={liveNodeCount}
      uploadsInProgress={uploadsInProgress}
      collaboratorCount={collaboratorCount}
      collaboratorIds={collaboratorIds}
      pointerSenderIds={pointerSenderIds}
      selectionSenderIds={selectionSenderIds}
      onDiscardRecovery={(writerId) => void discardRecovery(writerId)}
      onRetryRecoveryStorage={retryRecoveryStorage}
      onRetryPendingScene={() => void retryPendingScene()}
      onDiscardPendingScene={() => void discardPendingScene()}
      onSelectSource={(source) => beginSourcePlacement([source])}
      onSelectWorkItems={beginSourcePlacement}
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
      renderCollaboratorAvatar={renderCollaboratorAvatar}
      shouldLoadEmbeddable={shouldLoadEmbeddable}
      onEmbeddableLoadRequest={onEmbeddableLoadRequest}
      hostToolbarItems={hostToolbarItems}
      toolShortcutOverrides={WORK_MAP_TOOL_SHORTCUTS}
      langCode={langCode}
      theme={isDarkTheme ? "dark" : "light"}
    />
  );
});

type EditorSurfaceProps = {
  workspaceSlug: string;
  projectId: string;
  workMapId: string;
  initialScene: Promise<{ elements: readonly ExcalidrawElement[]; files: BinaryFiles }>;
  initialElements: readonly ExcalidrawElement[];
  editable: boolean;
  serverMutationAllowed: boolean;
  connectionState: string;
  connectionDataState: string;
  persistenceStatus: TPersistenceStatus;
  pickerSourceKind: TWorkMapSourceKind | null;
  workItemAction: WorkMapWorkItemAction;
  recoveryEntries: readonly TRecoveryEntry[];
  recoveryStorageFailed: boolean;
  pendingScene: boolean;
  elementCount: number;
  liveNodeCount: number;
  uploadsInProgress: boolean;
  collaboratorCount: number;
  collaboratorIds: string;
  pointerSenderIds: string;
  selectionSenderIds: string;
  onDiscardRecovery: (writerId: string) => void;
  onRetryRecoveryStorage: () => void;
  onRetryPendingScene: () => void;
  onDiscardPendingScene: () => void;
  onSelectSource: (source: TWorkMapSource) => void;
  onSelectWorkItems: (sources: WorkMapPlacementSource[]) => void;
  onClosePicker: () => void;
  onExcalidrawAPI: (api: ExcalidrawImperativeAPI | null) => void;
  onChange: NonNullable<ComponentProps<typeof Excalidraw>["onChange"]>;
  onPointerUpdate: NonNullable<ComponentProps<typeof Excalidraw>["onPointerUpdate"]>;
  onDoubleClick: MouseEventHandler<HTMLDivElement>;
  placementPointer: { x: number; y: number; zoom: number } | null;
  pendingSourceName: string | null;
  onPointerDown: NonNullable<ComponentProps<typeof Excalidraw>["onPointerDown"]>;
  onPaste: NonNullable<ComponentProps<typeof Excalidraw>["onPaste"]>;
  renderHostElement: NonNullable<ComponentProps<typeof Excalidraw>["renderHostElement"]>;
  renderCollaboratorAvatar: NonNullable<ComponentProps<typeof Excalidraw>["renderCollaboratorAvatar"]>;
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
  initialElements,
  editable,
  serverMutationAllowed,
  connectionState,
  connectionDataState,
  persistenceStatus,
  pickerSourceKind,
  workItemAction,
  recoveryEntries,
  recoveryStorageFailed,
  pendingScene,
  elementCount,
  liveNodeCount,
  uploadsInProgress,
  collaboratorCount,
  collaboratorIds,
  pointerSenderIds,
  selectionSenderIds,
  onDiscardRecovery,
  onRetryRecoveryStorage,
  onRetryPendingScene,
  onDiscardPendingScene,
  onSelectSource,
  onSelectWorkItems,
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
  renderCollaboratorAvatar,
  shouldLoadEmbeddable,
  onEmbeddableLoadRequest,
  hostToolbarItems,
  toolShortcutOverrides,
  langCode,
  theme,
}: EditorSurfaceProps) {
  const { t } = useTranslation();
  const hasRecoveryAction = pendingScene || recoveryStorageFailed || recoveryEntries.length > 0;
  const updateStatus = hasRecoveryAction
    ? null
    : uploadsInProgress || persistenceStatus === "pending" || persistenceStatus === "saving"
      ? "saving"
      : persistenceStatus === "error"
        ? "error"
        : "saved";
  return (
    <div
      data-testid="work-map-canvas"
      data-element-count={elementCount}
      data-live-node-count={liveNodeCount}
      className="relative size-full overflow-hidden bg-surface-1"
    >
      <span data-testid="work-map-connection-state" data-state={connectionDataState} aria-hidden="true" />
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
      <RecoveryPanel
        entries={recoveryEntries}
        onDiscard={onDiscardRecovery}
        pendingScene={pendingScene}
        onRetryPendingScene={onRetryPendingScene}
        onDiscardPendingScene={onDiscardPendingScene}
        storageFailed={recoveryStorageFailed}
        onRetryStorage={onRetryRecoveryStorage}
      />
      {serverMutationAllowed && pickerSourceKind === "work-item" && (
        <WorkMapWorkItemPicker
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          workMapId={workMapId}
          action={workItemAction}
          onSelect={onSelectWorkItems}
          onClose={onClosePicker}
        />
      )}
      {serverMutationAllowed && pickerSourceKind && pickerSourceKind !== "work-item" && (
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
      <div data-testid="work-map-embed" className="work-map-editor size-full" onDoubleClick={onDoubleClick}>
        <Excalidraw
          renderHostElement={renderHostElement}
          renderCollaboratorAvatar={renderCollaboratorAvatar}
          onExcalidrawAPI={onExcalidrawAPI}
          initialData={initialScene}
          initialState={{ viewport: { target: initialElements, fit: "scale-down", offsets: { ui: true } } }}
          onChange={onChange}
          onPointerUpdate={onPointerUpdate}
          onPointerDown={onPointerDown}
          onPaste={onPaste}
          isCollaborating={connectionState === "connected"}
          shouldLoadEmbeddable={shouldLoadEmbeddable}
          onEmbeddableLoadRequest={onEmbeddableLoadRequest}
          validateEmbeddable={isEmbeddableLinkAllowed}
          viewModeEnabled={!editable}
          activeTool={
            editable && pendingSourceName !== null ? { type: "custom", customType: "work-map-source" } : undefined
          }
          hostToolbarItems={hostToolbarItems}
          toolShortcutOverrides={toolShortcutOverrides}
          langCode={langCode}
          viewportStatusFrame={
            updateStatus
              ? {
                  border: false,
                  label: {
                    background: "transparent",
                    label: (
                      <UpdateStatus status={updateStatus} errorLabel={t("common.work_map.recovery.save_failed")} />
                    ),
                  },
                }
              : null
          }
          theme={theme}
          aiEnabled={false}
          UIOptions={{
            tools: { image: serverMutationAllowed },
            library: false,
            canvasActions: { export: false, saveAsImage: false, loadScene: false, saveToActiveFile: false },
            socialLinks: false,
          }}
        />
      </div>
    </div>
  );
}
