/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Hocuspocus } from "@hocuspocus/server";
import type { Request } from "express";
import type { WebSocket } from "ws";
import { Controller, WebSocket as WSDecorator } from "@plane/decorators";
import { WorkMapRelay } from "@/services/work-map-relay";

@Controller("/work-maps")
export class WorkMapController {
  [key: string]: unknown;

  constructor(
    _hocuspocusServer: Hocuspocus,
    private readonly relay: WorkMapRelay
  ) {}

  @WSDecorator("/")
  handleConnection(ws: WebSocket, request: Request) {
    void this.relay.handleConnection(ws, request);
  }
}
