/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { SocketId } from "@excalidraw/excalidraw/types";
import {
  createPointerUpdateFrame,
  expireCollaborators,
  parseAwarenessFrame,
  projectCollaborator,
  type TCollaboratorLease,
} from "./awareness";

describe("Work map awareness boundary", () => {
  it("projects only relay-owned pointer fields from the native payload", () => {
    const nativeUpdate = {
      pointer: { x: 10, y: 20, tool: "pointer" as const },
      button: "up" as const,
      pointersMap: new Map(),
    };
    expect(createPointerUpdateFrame(nativeUpdate, { element: true })).toEqual({
      type: "POINTER_UPDATE",
      payload: {
        pointer: nativeUpdate.pointer,
        button: "up",
        selectedElementIds: { element: true },
      },
    });
  });

  it("accepts the closed native pointer projection", () => {
    const frame = parseAwarenessFrame({
      type: "POINTER_UPDATE",
      senderId: "user-id",
      connectionId: "connection-id",
      profile: { display_name: "Ada", avatar_url: "https://cdn.example/ada.png" },
      payload: {
        pointer: { x: 10, y: 20, tool: "pointer" },
        button: "up",
        selectedElementIds: { element: true },
      },
    });
    expect(frame?.type).toBe("POINTER_UPDATE");
  });

  it("rejects non-boolean selection membership", () => {
    expect(() =>
      parseAwarenessFrame({
        type: "POINTER_UPDATE",
        senderId: "user-id",
        connectionId: "connection-id",
        profile: { display_name: "Ada", avatar_url: null },
        payload: {
          pointer: { x: 10, y: 20, tool: "pointer" },
          button: "up",
          selectedElementIds: { element: false },
        },
      })
    ).toThrow("Invalid awareness frame");
  });

  it("projects the server profile and rejects claimed profile identity", () => {
    const frame = parseAwarenessFrame({
      type: "PRESENCE_UPDATE",
      senderId: "user-id",
      connectionId: "connection-id",
      profile: { display_name: "Ada", avatar_url: "https://cdn.example/ada.png" },
      payload: { state: "active" },
    });
    if (!frame) throw new Error("Expected awareness frame");
    expect(projectCollaborator(frame)).toMatchObject({
      id: "user-id",
      socketId: "connection-id",
      username: "Ada",
      avatarUrl: "https://cdn.example/ada.png",
    });
    expect(() =>
      parseAwarenessFrame({
        type: "PRESENCE_UPDATE",
        senderId: "user-id",
        connectionId: "connection-id",
        profile: { display_name: "Ada", avatar_url: null, id: "claimed-user" },
        payload: { state: "active" },
      })
    ).toThrow("Invalid awareness frame");
  });

  it("expires collaborators whose bounded presence lease elapsed", () => {
    const expired = "expired" as SocketId;
    const current = "current" as SocketId;
    const collaborators = new Map<SocketId, TCollaboratorLease>([
      [expired, { collaborator: { id: "user-a" }, lastSeen: 10 }],
      [current, { collaborator: { id: "user-b" }, lastSeen: 40 }],
    ]);
    expect(expireCollaborators(collaborators, 30)).toBe(true);
    expect([...collaborators.keys()]).toEqual([current]);
  });
});
