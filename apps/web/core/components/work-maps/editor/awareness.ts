/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Collaborator, SocketId } from "@excalidraw/excalidraw/types";

export type TCollaboratorLease = { collaborator: Collaborator; lastSeen: number };

export type TAwarenessFrame =
  | {
      type: "POINTER_UPDATE";
      senderId: string;
      connectionId: string;
      payload: {
        pointer: { x: number; y: number; tool: "pointer" | "laser" };
        button: "down" | "up";
        selectedElementIds: Record<string, true>;
      };
    }
  | {
      type: "PRESENCE_UPDATE";
      senderId: string;
      connectionId: string;
      payload: { state: "active" | "idle" | "away" };
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const expireCollaborators = (
  collaborators: Map<SocketId, TCollaboratorLease>,
  expiresBefore: number
): boolean => {
  let changed = false;
  collaborators.forEach((entry, socketId) => {
    if (entry.lastSeen >= expiresBefore) return;
    collaborators.delete(socketId);
    changed = true;
  });
  return changed;
};

export const parseAwarenessFrame = (message: Record<string, unknown>): TAwarenessFrame | null => {
  if (message.type !== "POINTER_UPDATE" && message.type !== "PRESENCE_UPDATE") return null;
  if (typeof message.senderId !== "string" || typeof message.connectionId !== "string" || !isRecord(message.payload))
    throw new Error("Invalid awareness frame");
  if (message.type === "PRESENCE_UPDATE") {
    if (!["active", "idle", "away"].includes(message.payload.state as string))
      throw new Error("Invalid awareness frame");
    return message as TAwarenessFrame;
  }
  const { pointer, button, selectedElementIds } = message.payload;
  if (
    !isRecord(pointer) ||
    typeof pointer.x !== "number" ||
    typeof pointer.y !== "number" ||
    (pointer.tool !== "pointer" && pointer.tool !== "laser") ||
    (button !== "down" && button !== "up") ||
    !isRecord(selectedElementIds) ||
    Object.values(selectedElementIds).some((selected) => selected !== true)
  )
    throw new Error("Invalid awareness frame");
  return message as TAwarenessFrame;
};
