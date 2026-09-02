/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import type { SocketId } from "@excalidraw/excalidraw/types";
import { expireCollaborators, parseAwarenessFrame, type TCollaboratorLease } from "./awareness";

describe("Work Map awareness boundary", () => {
  it("accepts the closed native pointer projection", () => {
    const frame = parseAwarenessFrame({
      type: "POINTER_UPDATE",
      senderId: "user-id",
      connectionId: "connection-id",
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
        payload: {
          pointer: { x: 10, y: 20, tool: "pointer" },
          button: "up",
          selectedElementIds: { element: false },
        },
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
