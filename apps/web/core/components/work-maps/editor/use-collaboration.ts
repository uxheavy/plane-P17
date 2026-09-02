/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { LIVE_BASE_PATH, LIVE_BASE_URL } from "@plane/constants";
import { parseAwarenessFrame } from "./awareness";
import { parseSourceInvalidationFrame } from "./source-invalidation";
import { useAwareness } from "./use-awareness";

export type TConnectionState = "connecting" | "connected" | "disconnected";

const MAX_RECONNECT_ATTEMPTS = 3;
const MAX_PRE_READY_SCENES = 100;

const relayUrl = (workspaceSlug: string, projectId: string, workMapId: string, generation: number) => {
  const base = LIVE_BASE_URL?.trim() || window.location.origin;
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${LIVE_BASE_PATH}/work-maps/`;
  url.searchParams.set("workspaceSlug", workspaceSlug);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("workMapId", workMapId);
  url.searchParams.set("generation", String(generation));
  return url.toString();
};

type TContext = {
  workspaceSlug: string;
  projectId: string;
  workMapId: string;
};

type TSceneOwners = {
  generationRef: MutableRefObject<number>;
  resynchronize: () => Promise<void>;
  applyRemoteScene: (sceneBinary: string) => Promise<void>;
  invalidateSources: (nodeKeys: string[]) => Promise<void>;
  failCloseSources: () => void;
};

export const useCollaboration = (
  enabled: boolean,
  context: TContext,
  scene: TSceneOwners,
  onAuthorized: (editable: boolean) => void,
  api: ExcalidrawImperativeAPI | null
) => {
  const { workspaceSlug, projectId, workMapId } = context;
  const [connectionState, setConnectionState] = useState<TConnectionState>("connecting");
  const [relayEditable, setRelayEditable] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const connectionStateRef = useRef<TConnectionState>("connecting");
  const updateConnectionState = useCallback((state: TConnectionState) => {
    connectionStateRef.current = state;
    setConnectionState(state);
  }, []);

  const sendFrame = useCallback((frame: unknown) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify(frame));
  }, []);
  const awareness = useAwareness(enabled, connectionState === "connected", api, sendFrame);
  const { applyAwareness, clearCollaborators, ...awarenessState } = awareness;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let reconnectTimer: number | undefined;
    let reconnectAttempts = 0;
    const queuedRemoteScenes: string[] = [];
    let ready = false;
    let readyBarrierStarted = false;
    let remoteApply = Promise.resolve();

    const scheduleReconnect = (code: number) => {
      if (disposed || code === 1000 || code === 4400 || code === 4403) return;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
      const delay = 500 * 2 ** reconnectAttempts;
      reconnectAttempts += 1;
      reconnectTimer = window.setTimeout(() => {
        if (code !== 4409) {
          connect();
          return;
        }
        void scene
          .resynchronize()
          .then(connect)
          .catch(() => updateConnectionState("disconnected"));
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      ready = false;
      readyBarrierStarted = false;
      queuedRemoteScenes.length = 0;
      remoteApply = Promise.resolve();
      setRelayEditable(false);
      updateConnectionState("connecting");
      const socket = new WebSocket(relayUrl(workspaceSlug, projectId, workMapId, scene.generationRef.current));
      socketRef.current = socket;

      const closeForTransportFailure = () => {
        setRelayEditable(false);
        updateConnectionState("disconnected");
        scene.failCloseSources();
        socket.close(1011, "Scene synchronization failed");
      };

      socket.addEventListener("message", (event) => {
        let message: Record<string, unknown>;
        try {
          if (typeof event.data !== "string") throw new Error("Invalid relay frame");
          const parsed: unknown = JSON.parse(event.data);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid relay frame");
          message = parsed as Record<string, unknown>;
        } catch {
          socket.close(4400, "Invalid relay frame");
          return;
        }

        if (message.type === "ready") {
          if (
            readyBarrierStarted ||
            typeof message.generation !== "number" ||
            !Number.isInteger(message.generation) ||
            message.generation < 0 ||
            typeof message.editable !== "boolean"
          ) {
            socket.close(4400, "Invalid relay frame");
            return;
          }
          readyBarrierStarted = true;
          void (async () => {
            try {
              await scene.resynchronize();
              while (queuedRemoteScenes.length > 0) {
                const sceneBinary = queuedRemoteScenes.shift();
                // oxlint-disable-next-line eslint/no-await-in-loop -- whole-scene reconciliation must preserve relay order.
                if (sceneBinary) await scene.applyRemoteScene(sceneBinary);
              }
              if (disposed || socket !== socketRef.current || socket.readyState !== WebSocket.OPEN) return;
              ready = true;
              reconnectAttempts = 0;
              setRelayEditable(message.editable as boolean);
              updateConnectionState("connected");
              onAuthorized(message.editable as boolean);
            } catch {
              closeForTransportFailure();
            }
          })();
          return;
        }

        if (message.type === "SCENE_UPDATE") {
          if (typeof message.payload !== "string") {
            socket.close(4400, "Invalid relay frame");
            return;
          }
          if (!ready) {
            if (queuedRemoteScenes.length >= MAX_PRE_READY_SCENES) {
              closeForTransportFailure();
              return;
            }
            queuedRemoteScenes.push(message.payload);
            return;
          }
          const sceneBinary = message.payload;
          remoteApply = remoteApply.then(() => scene.applyRemoteScene(sceneBinary)).catch(closeForTransportFailure);
          return;
        }

        try {
          const invalidatedNodeKeys = parseSourceInvalidationFrame(message);
          if (invalidatedNodeKeys) {
            void scene.invalidateSources(invalidatedNodeKeys);
            return;
          }
        } catch {
          socket.close(4400, "Invalid relay frame");
          return;
        }

        try {
          const frame = parseAwarenessFrame(message);
          if (!frame) throw new Error("Invalid relay frame");
          applyAwareness(frame);
        } catch {
          socket.close(4400, "Invalid relay frame");
        }
      });
      socket.addEventListener("error", () => {
        setRelayEditable(false);
        updateConnectionState("disconnected");
      });
      socket.addEventListener("close", (event) => {
        if (socket !== socketRef.current) return;
        socketRef.current = null;
        setRelayEditable(false);
        updateConnectionState("disconnected");
        if (event.code === 1011) scene.failCloseSources();
        clearCollaborators();
        scheduleReconnect(event.code);
      });
    };

    const reconnectOnResume = () => {
      if (connectionStateRef.current !== "disconnected" || socketRef.current) return;
      window.clearTimeout(reconnectTimer);
      reconnectAttempts = 0;
      connect();
    };

    connect();
    window.addEventListener("focus", reconnectOnResume);
    window.addEventListener("online", reconnectOnResume);
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.removeEventListener("focus", reconnectOnResume);
      window.removeEventListener("online", reconnectOnResume);
      const socket = socketRef.current;
      socketRef.current = null;
      clearCollaborators();
      socket?.close(1000, "Editor closed");
    };
  }, [
    applyAwareness,
    clearCollaborators,
    enabled,
    onAuthorized,
    projectId,
    scene,
    updateConnectionState,
    workMapId,
    workspaceSlug,
  ]);

  const sendScene = useCallback(
    (sceneBinary: string) => sendFrame({ type: "SCENE_UPDATE", payload: sceneBinary }),
    [sendFrame]
  );

  return {
    connectionState,
    relayEditable,
    sendScene,
    ...awarenessState,
  };
};
