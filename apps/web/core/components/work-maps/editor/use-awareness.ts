/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaptureUpdateAction, UserIdleState } from "@excalidraw/excalidraw";
import type { Collaborator, ExcalidrawImperativeAPI, SocketId } from "@excalidraw/excalidraw/types";
import { throttle } from "lodash-es";
import {
  createPointerUpdateFrame,
  expireCollaborators,
  type TAwarenessFrame,
  type TCollaboratorLease,
} from "./awareness";

const POINTER_INTERVAL = 33;
const PRESENCE_INTERVAL = 10_000;
const PRESENCE_LEASE = 30_000;

type TPointerUpdate = (payload: {
  pointer: { x: number; y: number; tool: "pointer" | "laser" };
  button: "down" | "up";
}) => void;

type TAwareness = {
  applyAwareness: (frame: TAwarenessFrame) => void;
  clearCollaborators: () => void;
  onPointerUpdate: TPointerUpdate;
  collaboratorCount: number;
  collaboratorIds: string;
  pointerSenderIds: string;
  selectionSenderIds: string;
};

export const useAwareness = (
  enabled: boolean,
  connected: boolean,
  api: ExcalidrawImperativeAPI | null,
  sendFrame: (frame: unknown) => void
): TAwareness => {
  const collaboratorsRef = useRef(new Map<SocketId, TCollaboratorLease>());
  const [readback, setReadback] = useState({ count: 0, ids: "", pointerIds: "", selectionIds: "" });

  const publishCollaborators = useCallback(() => {
    const collaborators = new Map<SocketId, Collaborator>();
    const senderIds: string[] = [];
    const pointerSenderIds: string[] = [];
    const selectionSenderIds: string[] = [];
    collaboratorsRef.current.forEach(({ collaborator }, connectionId) => {
      collaborators.set(connectionId, collaborator);
      if (!collaborator.id) return;
      senderIds.push(collaborator.id);
      if (collaborator.pointer) pointerSenderIds.push(collaborator.id);
      if (Object.values(collaborator.selectedElementIds ?? {}).some(Boolean)) selectionSenderIds.push(collaborator.id);
    });
    api?.updateScene({ collaborators, captureUpdate: CaptureUpdateAction.NEVER });
    const next = {
      count: collaborators.size,
      // oxlint-disable-next-line eslint-plugin-unicorn/no-array-sort -- this app's TypeScript target predates toSorted.
      ids: senderIds.sort().join(","),
      // oxlint-disable-next-line eslint-plugin-unicorn/no-array-sort -- this app's TypeScript target predates toSorted.
      pointerIds: pointerSenderIds.sort().join(","),
      // oxlint-disable-next-line eslint-plugin-unicorn/no-array-sort -- this app's TypeScript target predates toSorted.
      selectionIds: selectionSenderIds.sort().join(","),
    };
    setReadback((current) =>
      Object.entries(next).every(([key, value]) => current[key as keyof typeof current] === value) ? current : next
    );
  }, [api]);

  const clearCollaborators = useCallback(() => {
    if (collaboratorsRef.current.size === 0) return;
    collaboratorsRef.current.clear();
    publishCollaborators();
  }, [publishCollaborators]);

  const applyAwareness = useCallback(
    (frame: TAwarenessFrame) => {
      const socketId = frame.connectionId as SocketId;
      const current = collaboratorsRef.current.get(socketId)?.collaborator;
      const identity = { id: frame.senderId, socketId, username: current?.username ?? "Collaborator" };
      const collaborator: Collaborator =
        frame.type === "POINTER_UPDATE"
          ? {
              ...current,
              ...identity,
              pointer: frame.payload.pointer,
              button: frame.payload.button,
              selectedElementIds: frame.payload.selectedElementIds,
            }
          : {
              ...current,
              ...identity,
              userState: {
                active: UserIdleState.ACTIVE,
                idle: UserIdleState.IDLE,
                away: UserIdleState.AWAY,
              }[frame.payload.state],
            };
      collaboratorsRef.current.set(socketId, { collaborator, lastSeen: Date.now() });
      publishCollaborators();
    },
    [publishCollaborators]
  );

  const onPointerUpdate = useMemo(
    () =>
      throttle(
        (payload: Parameters<TPointerUpdate>[0]) => {
          if (!connected) return;
          const selectedElementIds = Object.fromEntries(
            Object.entries(api?.getAppState().selectedElementIds ?? {}).filter(([, selected]) => selected)
          ) as Record<string, true>;
          sendFrame(createPointerUpdateFrame(payload, selectedElementIds));
        },
        POINTER_INTERVAL,
        { leading: true, trailing: true }
      ),
    [api, connected, sendFrame]
  );

  useEffect(() => () => onPointerUpdate.cancel(), [onPointerUpdate]);

  useEffect(() => {
    if (!enabled || !connected) return;
    const sendPresence = () => {
      const state = document.hidden ? "away" : document.hasFocus() ? "active" : "idle";
      sendFrame({ type: "PRESENCE_UPDATE", payload: { state } });
    };
    sendPresence();
    const interval = window.setInterval(sendPresence, PRESENCE_INTERVAL);
    window.addEventListener("focus", sendPresence);
    window.addEventListener("blur", sendPresence);
    document.addEventListener("visibilitychange", sendPresence);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", sendPresence);
      window.removeEventListener("blur", sendPresence);
      document.removeEventListener("visibilitychange", sendPresence);
    };
  }, [connected, enabled, sendFrame]);

  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => {
      if (expireCollaborators(collaboratorsRef.current, Date.now() - PRESENCE_LEASE)) publishCollaborators();
    }, PRESENCE_INTERVAL);
    return () => window.clearInterval(interval);
  }, [enabled, publishCollaborators]);

  return {
    applyAwareness,
    clearCollaborators,
    onPointerUpdate,
    collaboratorCount: readback.count,
    collaboratorIds: readback.ids,
    pointerSenderIds: readback.pointerIds,
    selectionSenderIds: readback.selectionIds,
  };
};
