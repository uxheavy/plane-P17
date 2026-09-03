/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { EventEmitter } from "node:events";
import type { Request } from "express";
import type { WebSocket } from "ws";
import { describe, expect, it, vi } from "vitest";
import type { WorkMapAuthorization } from "@/services/work-map.service";
import { WorkMapRelay } from "@/services/work-map-relay";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const WORK_MAP_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_WORK_MAP_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

const authorization = (overrides: Partial<WorkMapAuthorization> = {}): WorkMapAuthorization => ({
  document_type: "work_map",
  workspace_slug: "workspace",
  project_id: PROJECT_ID,
  work_map_id: WORK_MAP_ID,
  sender_id: USER_ID,
  generation: 7,
  readable: true,
  editable: true,
  is_locked: false,
  archived_at: null,
  ...overrides,
});

class TestWebSocket extends EventEmitter {
  readyState = 1;
  sent: string[] = [];
  closed: { code: number; reason: string } | null = null;

  send(payload: string) {
    this.sent.push(payload);
  }

  close(code: number, reason: string) {
    this.readyState = 3;
    this.closed = { code, reason };
    this.emit("close");
  }
}

class TestRedisBus {
  connections = new Set<TestRedisConnection>();
  published: { channel: string; message: string }[] = [];

  connect() {
    const connection = new TestRedisConnection(this);
    this.connections.add(connection);
    return connection;
  }

  publish(channel: string, message: string) {
    this.published.push({ channel, message });
    for (const connection of this.connections) {
      if (connection.channels.has(channel)) connection.emit("message", channel, message);
    }
    return Promise.resolve(this.connections.size);
  }
}

class TestRedisConnection extends EventEmitter {
  channels = new Set<string>();

  constructor(private readonly bus: TestRedisBus) {
    super();
  }

  publish(channel: string, message: string) {
    return this.bus.publish(channel, message);
  }

  async subscribe(channel: string) {
    this.channels.add(channel);
  }

  async unsubscribe(channel: string) {
    this.channels.delete(channel);
  }

  async quit() {}
}

const request = (workMapId = WORK_MAP_ID, generation = 7, projectId = PROJECT_ID) =>
  ({
    url: `/?workspaceSlug=workspace&projectId=${projectId}&workMapId=${workMapId}&generation=${generation}`,
    headers: { cookie: "session=test" },
  }) as Request;

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

const websocket = () => new TestWebSocket() as unknown as WebSocket;

const initializeRelay = async (
  bus: TestRedisBus,
  authorize: (
    workspaceSlug: string,
    projectId: string,
    workMapId: string,
    cookie: string
  ) => Promise<WorkMapAuthorization>
) => {
  const relay = new WorkMapRelay(authorize);
  await relay.initialize(bus.connect(), bus.connect());
  return relay;
};

describe("WorkMapRelay", () => {
  it("does not accept frames before authorization and limits read-only viewers to awareness", async () => {
    let resolveAuthorization!: (value: WorkMapAuthorization) => void;
    const pendingAuthorization = new Promise<WorkMapAuthorization>((resolve) => {
      resolveAuthorization = resolve;
    });
    const bus = new TestRedisBus();
    const relay = await initializeRelay(bus, () => pendingAuthorization);
    const ws = websocket();

    void relay.handleConnection(ws, request());
    ws.emit("message", Buffer.from('{"type":"PRESENCE_UPDATE","payload":{"state":"active"}}'), false);
    expect(bus.published).toHaveLength(0);

    resolveAuthorization(authorization({ editable: false }));
    await nextTurn();
    ws.emit("message", Buffer.from('{"type":"PRESENCE_UPDATE","payload":{"state":"active"}}'), false);
    ws.emit(
      "message",
      Buffer.from(
        '{"type":"POINTER_UPDATE","payload":{"pointer":{"x":1,"y":2,"tool":"pointer"},"button":"up","selectedElementIds":{"element-a":true}}}'
      ),
      false
    );
    await nextTurn();

    expect(bus.published).toHaveLength(2);
    expect((ws as unknown as TestWebSocket).closed).toBeNull();
    ws.emit("message", Buffer.from('{"type":"SCENE_UPDATE","payload":"AQI="}'), false);
    await nextTurn();
    expect((ws as unknown as TestWebSocket).closed?.code).toBe(4403);
    await relay.destroy();
  });

  it("rejects invalid and oversized frames", async () => {
    const bus = new TestRedisBus();
    const relay = await initializeRelay(bus, async () => authorization());
    const invalid = websocket();
    const oversized = websocket();
    void relay.handleConnection(invalid, request());
    void relay.handleConnection(oversized, request());
    await nextTurn();

    invalid.emit("message", Buffer.from('{"type":"UNKNOWN"}'), false);
    oversized.emit("message", Buffer.alloc(5 * 1024 * 1024 + 1, "x"), false);
    await nextTurn();

    expect((invalid as unknown as TestWebSocket).closed?.code).toBe(4400);
    expect((oversized as unknown as TestWebSocket).closed?.code).toBe(4400);
    expect(bus.published).toHaveLength(0);
    await relay.destroy();
  });

  it("reauthorizes active connections and closes revoked access", async () => {
    vi.useFakeTimers();
    const bus = new TestRedisBus();
    const authorize = vi.fn().mockResolvedValueOnce(authorization()).mockRejectedValueOnce(new Error("revoked"));
    const relay = await initializeRelay(bus, authorize);
    const ws = websocket();
    void relay.handleConnection(ws, request());
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(authorize).toHaveBeenCalledTimes(2);
    expect((ws as unknown as TestWebSocket).closed?.code).toBe(4403);
    await relay.destroy();
    vi.useRealTimers();
  });

  it("forwards validated frames across instances without self-echo or cross-room leakage", async () => {
    const bus = new TestRedisBus();
    const authorize = vi.fn(async (_workspace: string, projectId: string, workMapId: string) =>
      authorization({ project_id: projectId, work_map_id: workMapId })
    );
    const firstRelay = await initializeRelay(bus, authorize);
    const secondRelay = await initializeRelay(bus, authorize);
    const sender = websocket();
    const peer = websocket();
    const otherRoom = websocket();
    void firstRelay.handleConnection(sender, request());
    void secondRelay.handleConnection(peer, request(WORK_MAP_ID, 7, OTHER_PROJECT_ID));
    void secondRelay.handleConnection(otherRoom, request(OTHER_WORK_MAP_ID));
    await nextTurn();
    const senderSocket = sender as unknown as TestWebSocket;
    const peerSocket = peer as unknown as TestWebSocket;
    const otherSocket = otherRoom as unknown as TestWebSocket;
    senderSocket.sent.length = 0;
    peerSocket.sent.length = 0;
    otherSocket.sent.length = 0;

    sender.emit("message", Buffer.from('{"type":"SCENE_UPDATE","payload":"AQI="}'), false);
    await nextTurn();

    expect(senderSocket.sent).toHaveLength(0);
    expect(otherSocket.sent).toHaveLength(0);
    expect(peerSocket.sent).toHaveLength(1);
    expect(JSON.parse(peerSocket.sent[0])).toMatchObject({
      type: "SCENE_UPDATE",
      payload: "AQI=",
      senderId: USER_ID,
    });
    expect(JSON.parse(peerSocket.sent[0]).connectionId).toMatch(/^[0-9a-f-]{36}$/);
    senderSocket.close(1000, "Test complete");
    peerSocket.close(1000, "Test complete");
    otherSocket.close(1000, "Test complete");
    await Promise.all([firstRelay.destroy(), secondRelay.destroy()]);
  });
});
