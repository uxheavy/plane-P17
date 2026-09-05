/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { RawData, WebSocket } from "ws";
import { z } from "zod";
import { logger } from "@plane/logger";
import type { WorkMapAuthorization } from "@/services/work-map.service";
import { WorkMapService, workMapProfileSchema } from "@/services/work-map.service";
import { AdminCommand, CloseCode, ForceCloseReason } from "@/types/admin-commands";

const MAX_FRAME_BYTES = 5 * 1024 * 1024;
const REAUTHORIZE_INTERVAL_MS = 15_000;
const ADMIN_CHANNEL = "hocuspocus:admin";

const workMapConnectionSchema = z.object({
  workspaceSlug: z.string().min(1),
  projectId: z.string().uuid(),
  workMapId: z.string().uuid(),
  generation: z.coerce.number().int().nonnegative(),
});

const sceneUpdateSchema = z
  .object({
    type: z.literal("SCENE_UPDATE"),
    payload: z.string().max(MAX_FRAME_BYTES),
  })
  .strict();

const pointerUpdateSchema = z
  .object({
    type: z.literal("POINTER_UPDATE"),
    payload: z
      .object({
        pointer: z
          .object({ x: z.number().finite(), y: z.number().finite(), tool: z.enum(["pointer", "laser"]) })
          .strict(),
        button: z.enum(["down", "up"]),
        selectedElementIds: z.record(z.string(), z.literal(true)),
      })
      .strict(),
  })
  .strict();

const presenceUpdateSchema = z
  .object({
    type: z.literal("PRESENCE_UPDATE"),
    payload: z.object({ state: z.enum(["active", "idle", "away"]) }).strict(),
  })
  .strict();

const workMapFrameSchema = z.discriminatedUnion("type", [sceneUpdateSchema, pointerUpdateSchema, presenceUpdateSchema]);

const forceCloseCommandSchema = z
  .object({
    command: z.literal(AdminCommand.FORCE_CLOSE),
    docId: z.string().uuid(),
    reason: z.nativeEnum(ForceCloseReason),
    code: z.nativeEnum(CloseCode),
    originServer: z.string().min(1),
    timestamp: z.string().optional(),
  })
  .strict();

type WorkMapConnection = z.infer<typeof workMapConnectionSchema>;
type WorkMapFrame = z.infer<typeof workMapFrameSchema>;
type WorkMapAuthorizer = (
  workspaceSlug: string,
  projectId: string,
  workMapId: string,
  cookie: string
) => Promise<WorkMapAuthorization>;

export type WorkMapRelayPublisher = {
  publish(channel: string, message: string): Promise<number>;
  quit(): Promise<unknown>;
};

export type WorkMapRelaySubscriber = {
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(event: "message", listener: (channel: string, message: string) => void): unknown;
  removeListener(event: "message", listener: (channel: string, message: string) => void): unknown;
  quit(): Promise<unknown>;
};

type RelayEnvelope = {
  connectionId: string;
  senderId: string;
  profile: WorkMapAuthorization["profile"];
  frame: WorkMapFrame;
};

export const parseWorkMapFrame = (data: RawData, isBinary: boolean): WorkMapFrame | null => {
  const byteLength = Array.isArray(data) ? data.reduce((total, part) => total + part.byteLength, 0) : data.byteLength;
  if (isBinary || byteLength > MAX_FRAME_BYTES) return null;
  try {
    return workMapFrameSchema.parse(JSON.parse(data.toString()));
  } catch {
    return null;
  }
};

export const workMapRoomName = (authorization: WorkMapAuthorization) =>
  `work-map:${encodeURIComponent(authorization.workspace_slug)}:${authorization.work_map_id}`;

export class WorkMapRelay {
  private readonly authorizer: WorkMapAuthorizer;
  private publisher: WorkMapRelayPublisher | null = null;
  private subscriber: WorkMapRelaySubscriber | null = null;
  private readonly rooms = new Map<string, Map<WebSocket, string>>();
  private readonly workMapConnections = new Map<string, Set<WebSocket>>();

  constructor(authorizer?: WorkMapAuthorizer) {
    if (authorizer) {
      this.authorizer = authorizer;
    } else {
      const service = new WorkMapService();
      this.authorizer = service.authorize.bind(service);
    }
  }

  async initialize(publisher: WorkMapRelayPublisher, subscriber: WorkMapRelaySubscriber) {
    this.publisher = publisher;
    this.subscriber = subscriber;
    await this.subscriber.subscribe(ADMIN_CHANNEL);
    this.subscriber.on("message", this.handleRedisMessage);
  }

  async handleConnection(ws: WebSocket, request: Request) {
    let closed = false;
    ws.once("close", () => {
      closed = true;
    });

    try {
      const connection = this.parseConnection(request);
      const cookie = request.headers.cookie;
      if (!cookie) {
        ws.close(4401, "Authentication required");
        return;
      }

      let authorization = await this.authorizer(
        connection.workspaceSlug,
        connection.projectId,
        connection.workMapId,
        cookie
      );
      if (closed) return;
      if (authorization.generation !== connection.generation) {
        ws.close(4409, "Work map generation changed");
        return;
      }

      const room = workMapRoomName(authorization);
      const connectionId = randomUUID();
      await this.join(room, authorization.work_map_id, ws, connectionId);
      ws.send(
        JSON.stringify({ type: "ready", generation: authorization.generation, editable: authorization.editable })
      );

      let reauthorizing = false;
      const reauthorize = setInterval(() => {
        if (reauthorizing) return;
        reauthorizing = true;
        void this.authorizer(connection.workspaceSlug, connection.projectId, connection.workMapId, cookie)
          .then((current) => {
            if (
              current.workspace_slug !== authorization.workspace_slug ||
              current.project_id !== authorization.project_id ||
              current.work_map_id !== authorization.work_map_id
            ) {
              ws.close(4409, "Work map changed");
            } else if (current.collaboration_epoch !== authorization.collaboration_epoch) {
              ws.close(4409, "Work map authority changed");
            } else if (current.editable !== authorization.editable) {
              ws.close(4403, "Work map access changed");
            } else {
              authorization = current;
            }
            return undefined;
          })
          .catch(() => {
            ws.close(4403, "Work map unavailable");
          })
          .finally(() => {
            reauthorizing = false;
          });
      }, REAUTHORIZE_INTERVAL_MS);

      ws.on("message", (data, isBinary) => {
        void this.handleFrame(room, connectionId, authorization, ws, data, isBinary);
      });
      ws.on("close", () => {
        clearInterval(reauthorize);
        void this.leave(room, authorization.work_map_id, ws);
      });
    } catch {
      ws.close(4403, "Work map unavailable");
    }
  }

  async destroy() {
    this.subscriber?.removeListener("message", this.handleRedisMessage);
    await Promise.all([this.publisher?.quit(), this.subscriber?.unsubscribe(ADMIN_CHANNEL), this.subscriber?.quit()]);
    this.publisher = null;
    this.subscriber = null;
    this.rooms.clear();
    this.workMapConnections.clear();
  }

  private parseConnection(request: Request): WorkMapConnection {
    const url = new URL(request.url, "http://plane.local");
    return workMapConnectionSchema.parse(Object.fromEntries(url.searchParams));
  }

  private async join(room: string, workMapId: string, ws: WebSocket, connectionId: string) {
    if (!this.subscriber) throw new Error("Work map relay is not initialized");
    let connections = this.rooms.get(room);
    if (!connections) {
      connections = new Map();
      this.rooms.set(room, connections);
      await this.subscriber.subscribe(room);
    }
    connections.set(ws, connectionId);
    let workMapConnections = this.workMapConnections.get(workMapId);
    if (!workMapConnections) {
      workMapConnections = new Set();
      this.workMapConnections.set(workMapId, workMapConnections);
    }
    workMapConnections.add(ws);
  }

  private async leave(room: string, workMapId: string, ws: WebSocket) {
    const connections = this.rooms.get(room);
    if (connections) {
      connections.delete(ws);
      if (connections.size === 0) {
        this.rooms.delete(room);
        await this.subscriber?.unsubscribe(room);
      }
    }
    const workMapConnections = this.workMapConnections.get(workMapId);
    if (workMapConnections) {
      workMapConnections.delete(ws);
      if (workMapConnections.size === 0) this.workMapConnections.delete(workMapId);
    }
  }

  private async handleFrame(
    room: string,
    connectionId: string,
    authorization: WorkMapAuthorization,
    ws: WebSocket,
    data: RawData,
    isBinary: boolean
  ) {
    const frame = parseWorkMapFrame(data, isBinary);
    if (!frame) {
      ws.close(4400, "Invalid Work map frame");
      return;
    }
    if (!authorization.editable && frame.type === "SCENE_UPDATE") {
      ws.close(4403, "Work map is read-only");
      return;
    }
    if (!this.publisher) {
      ws.close(1011, "Realtime unavailable");
      return;
    }
    try {
      await this.publisher.publish(
        room,
        JSON.stringify({
          connectionId,
          senderId: authorization.sender_id,
          profile: authorization.profile,
          frame,
        } satisfies RelayEnvelope)
      );
    } catch {
      logger.error("WORK_MAP_RELAY: Failed to publish frame");
      ws.close(1011, "Realtime unavailable");
    }
  }

  private handleRedisMessage = (channel: string, message: string) => {
    if (channel === ADMIN_CHANNEL) {
      this.handleForceCloseCommand(message);
      return;
    }
    const connections = this.rooms.get(channel);
    if (!connections) return;
    try {
      const envelope = z
        .object({
          connectionId: z.string().uuid(),
          senderId: z.string().uuid(),
          profile: workMapProfileSchema,
          frame: workMapFrameSchema,
        })
        .parse(JSON.parse(message));
      const payload = JSON.stringify({
        ...envelope.frame,
        senderId: envelope.senderId,
        connectionId: envelope.connectionId,
        profile: envelope.profile,
      });
      for (const [connection, connectionId] of connections) {
        if (connectionId !== envelope.connectionId && connection.readyState === 1) connection.send(payload);
      }
    } catch {
      logger.warn("WORK_MAP_RELAY: Rejected invalid Redis frame");
    }
  };

  private handleForceCloseCommand(message: string) {
    try {
      const result = forceCloseCommandSchema.safeParse(JSON.parse(message));
      if (!result.success) {
        logger.warn("WORK_MAP_RELAY: Rejected invalid force close command");
        return;
      }
      const connections = this.workMapConnections.get(result.data.docId);
      if (!connections) return;
      for (const connection of connections) {
        if (connection.readyState === 1) connection.close(4409, "Work map authority changed");
      }
    } catch {
      logger.warn("WORK_MAP_RELAY: Rejected invalid force close command");
    }
  }
}
