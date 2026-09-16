/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Collaborator, SocketId } from "@excalidraw/excalidraw/types";
import { UserIdleState } from "@excalidraw/common";
import { getFileURL } from "@plane/utils";

export type TCollaboratorLease = { collaborator: Collaborator; lastSeen: number };

export type TWorkMapProfile = {
  display_name: string;
  avatar_url: string | null;
};

type TPointerUpdate = {
  pointer: { x: number; y: number; tool: "pointer" | "laser" };
  button: "down" | "up";
};

type TAwarenessIdentity = {
  senderId: string;
  connectionId: string;
  profile: TWorkMapProfile;
};

export type TAwarenessOutboundFrame =
  | {
      type: "POINTER_UPDATE";
      payload: {
        pointer: { x: number; y: number; tool: "pointer" | "laser" };
        button: "down" | "up";
        selectedElementIds: Record<string, true>;
      };
    }
  | {
      type: "PRESENCE_UPDATE";
      payload: { state: "active" | "idle" | "away" };
    };

export type TAwarenessFrame = TAwarenessOutboundFrame & TAwarenessIdentity;

export type TWorkMapOutboundFrame =
  | TAwarenessOutboundFrame
  | {
      type: "SCENE_UPDATE";
      payload: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isWorkMapProfile = (value: unknown): value is TWorkMapProfile => {
  if (!isRecord(value)) return false;
  if (typeof value.display_name !== "string") return false;
  if (!("avatar_url" in value) || (value.avatar_url !== null && typeof value.avatar_url !== "string")) return false;
  return Object.keys(value).every((key) => key === "display_name" || key === "avatar_url");
};

export const createPointerUpdateFrame = (
  update: TPointerUpdate,
  selectedElementIds: Record<string, true>
): TAwarenessOutboundFrame => ({
  type: "POINTER_UPDATE",
  payload: {
    pointer: update.pointer,
    button: update.button,
    selectedElementIds,
  },
});

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
  if (
    typeof message.senderId !== "string" ||
    message.senderId.length === 0 ||
    typeof message.connectionId !== "string" ||
    message.connectionId.length === 0 ||
    !isWorkMapProfile(message.profile) ||
    !isRecord(message.payload)
  )
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
    !Number.isFinite(pointer.x) ||
    typeof pointer.y !== "number" ||
    !Number.isFinite(pointer.y) ||
    (pointer.tool !== "pointer" && pointer.tool !== "laser") ||
    (button !== "down" && button !== "up") ||
    !isRecord(selectedElementIds) ||
    Object.values(selectedElementIds).some((selected) => selected !== true)
  )
    throw new Error("Invalid awareness frame");
  return message as TAwarenessFrame;
};

export const projectCollaborator = (frame: TAwarenessFrame, current?: Collaborator): Collaborator => {
  const { avatarUrl: _previousAvatarUrl, ...previous } = current ?? {};
  const avatarUrl = getFileURL(frame.profile.avatar_url ?? "");
  const identity: Collaborator = {
    ...previous,
    id: frame.senderId,
    socketId: frame.connectionId as SocketId,
    username: frame.profile.display_name,
    ...(avatarUrl ? { avatarUrl } : {}),
  };

  return frame.type === "POINTER_UPDATE"
    ? {
        ...identity,
        pointer: frame.payload.pointer,
        button: frame.payload.button,
        selectedElementIds: frame.payload.selectedElementIds,
      }
    : {
        ...identity,
        userState: {
          active: UserIdleState.ACTIVE,
          idle: UserIdleState.IDLE,
          away: UserIdleState.AWAY,
        }[frame.payload.state],
      };
};
