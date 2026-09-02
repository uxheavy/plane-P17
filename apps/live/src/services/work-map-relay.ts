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
import { WorkMapService } from "@/services/work-map.service";

const MAX_FRAME_BYTES = 5 * 1024 * 1024;
const REAUTHORIZE_INTERVAL_MS = 15_000;
const WORK_MAP_CONTROL_CHANNEL = "work-map:control";

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

const workMapForceCloseSchema = z
  .object({
    type: z.literal("FORCE_CLOSE"),
    workspaceSlug: z.string().min(1),
    workMapId: z.string().uuid(),
    reason: z.enum(["generation_changed", "authority_changed"]),
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
  on(event: "close", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "ready", listener: () => void): unknown;
  removeListener(event: "message", listener: (channel: string, message: string) => void): unknown;
  removeListener(event: "close", listener: () => void): unknown;
  removeListener(event: "error", listener: (error: Error) => void): unknown;
  removeListener(event: "ready", listener: () => void): unknown;
  quit(): Promise<unknown>;
};

type RelayEnvelope = {
  connectionId: string;
  senderId: string;
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
  private subscriberAvailable = false;
  private readonly rooms = new Map<string, Map<WebSocket, string>>();

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
    this.subscriber.on("message", this.handleRedisMessage);
    this.subscriber.on("close", this.handleSubscriberLoss);
    this.subscriber.on("error", this.handleSubscriberError);
    this.subscriber.on("ready", this.handleSubscriberReady);
    await this.subscriber.subscribe(WORK_MAP_CONTROL_CHANNEL);
    this.subscriberAvailable = true;
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

      const authorization = await this.authorizer(
        connection.workspaceSlug,
        connection.projectId,
        connection.workMapId,
        cookie
      );
      if (closed) return;
      if (!authorization.readable) {
        ws.close(4403, "Work map unavailable");
        return;
      }
      if (authorization.generation !== connection.generation) {
        ws.close(4409, "Work map generation changed");
        return;
      }

      const room = workMapRoomName(authorization);
      const connectionId = randomUUID();
      await this.join(room, ws, connectionId);
      const joinedAuthorization = await this.authorizer(
        connection.workspaceSlug,
        connection.projectId,
        connection.workMapId,
        cookie
      );
      if (
        joinedAuthorization.workspace_slug !== authorization.workspace_slug ||
        joinedAuthorization.project_id !== authorization.project_id ||
        joinedAuthorization.work_map_id !== authorization.work_map_id ||
        joinedAuthorization.generation !== authorization.generation ||
        joinedAuthorization.collaboration_epoch !== authorization.collaboration_epoch ||
        joinedAuthorization.readable !== authorization.readable ||
        joinedAuthorization.editable !== authorization.editable ||
        joinedAuthorization.is_locked !== authorization.is_locked ||
        joinedAuthorization.archived_at !== authorization.archived_at
      ) {
        await this.leave(room, ws);
        ws.close(4409, "Work map changed while connecting");
        return;
      }
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
            } else if (
              current.readable !== authorization.readable ||
              current.editable !== authorization.editable ||
              current.is_locked !== authorization.is_locked ||
              current.archived_at !== authorization.archived_at
            ) {
              ws.close(4403, "Work map access changed");
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
        void this.handleFrame(room, connectionId, authorization.sender_id, authorization.editable, ws, data, isBinary);
      });
      ws.on("close", () => {
        clearInterval(reauthorize);
        void this.leave(room, ws);
      });
    } catch {
      ws.close(4403, "Work map unavailable");
    }
  }

  async destroy() {
    this.subscriber?.removeListener("message", this.handleRedisMessage);
    this.subscriber?.removeListener("close", this.handleSubscriberLoss);
    this.subscriber?.removeListener("error", this.handleSubscriberError);
    this.subscriber?.removeListener("ready", this.handleSubscriberReady);
    await Promise.all([this.publisher?.quit(), this.subscriber?.quit()]);
    this.publisher = null;
    this.subscriber = null;
    this.subscriberAvailable = false;
    this.rooms.clear();
  }

  private parseConnection(request: Request): WorkMapConnection {
    const url = new URL(request.url, "http://plane.local");
    return workMapConnectionSchema.parse(Object.fromEntries(url.searchParams));
  }

  private async join(room: string, ws: WebSocket, connectionId: string) {
    if (!this.subscriber || !this.subscriberAvailable) throw new Error("Work Map relay is not initialized");
    let connections = this.rooms.get(room);
    if (!connections) {
      connections = new Map();
      this.rooms.set(room, connections);
      await this.subscriber.subscribe(room);
    }
    connections.set(ws, connectionId);
  }

  private async leave(room: string, ws: WebSocket) {
    const connections = this.rooms.get(room);
    if (!connections) return;
    connections.delete(ws);
    if (connections.size === 0) {
      this.rooms.delete(room);
      await this.subscriber?.unsubscribe(room);
    }
  }

  private async handleFrame(
    room: string,
    connectionId: string,
    senderId: string,
    editable: boolean,
    ws: WebSocket,
    data: RawData,
    isBinary: boolean
  ) {
    const frame = parseWorkMapFrame(data, isBinary);
    if (!frame) {
      ws.close(4400, "Invalid Work Map frame");
      return;
    }
    if (!editable && frame.type === "SCENE_UPDATE") {
      ws.close(4403, "Work map is read-only");
      return;
    }
    if (!this.publisher) {
      ws.close(1011, "Realtime unavailable");
      return;
    }
    try {
      await this.publisher.publish(room, JSON.stringify({ connectionId, senderId, frame } satisfies RelayEnvelope));
    } catch {
      logger.error("WORK_MAP_RELAY: Failed to publish frame");
      ws.close(1011, "Realtime unavailable");
    }
  }

  private handleRedisMessage = (room: string, message: string) => {
    if (room === WORK_MAP_CONTROL_CHANNEL) {
      try {
        this.closeLocalConnections(workMapForceCloseSchema.parse(JSON.parse(message)));
      } catch {
        logger.warn("WORK_MAP_RELAY: Rejected invalid control command");
      }
      return;
    }
    const connections = this.rooms.get(room);
    if (!connections) return;
    try {
      const envelope = z
        .object({ connectionId: z.string().uuid(), senderId: z.string().uuid(), frame: workMapFrameSchema })
        .parse(JSON.parse(message));
      const payload = JSON.stringify({
        ...envelope.frame,
        senderId: envelope.senderId,
        connectionId: envelope.connectionId,
      });
      for (const [connection, connectionId] of connections) {
        if (connectionId !== envelope.connectionId && connection.readyState === 1) connection.send(payload);
      }
    } catch {
      logger.warn("WORK_MAP_RELAY: Rejected invalid Redis frame");
    }
  };

  private handleSubscriberLoss = () => {
    this.subscriberAvailable = false;
    logger.error("WORK_MAP_RELAY: Redis subscription lost");
    const sockets: WebSocket[] = [];
    for (const connections of this.rooms.values()) sockets.push(...connections.keys());
    for (const socket of sockets) socket.close(1011, "Realtime subscription lost");
  };

  private handleSubscriberError = (error: Error) => {
    logger.error("WORK_MAP_RELAY: Redis subscriber error", error);
  };

  private handleSubscriberReady = () => {
    this.subscriberAvailable = true;
  };

  private closeLocalConnections(command: z.infer<typeof workMapForceCloseSchema>) {
    const room = `work-map:${encodeURIComponent(command.workspaceSlug)}:${command.workMapId}`;
    const sockets = [...(this.rooms.get(room)?.keys() ?? [])];
    const code = command.reason === "generation_changed" ? 4409 : 4403;
    const message = command.reason === "generation_changed" ? "Work map generation changed" : "Work map unavailable";
    for (const socket of sockets) socket.close(code, message);
  }
}
