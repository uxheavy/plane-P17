/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  IConversationAttachment,
  IConversationAttachmentUploadResponse,
  IConversationChannel,
  IConversationMessage,
  IConversationMessageInput,
  IConversationMessagePage,
} from "@plane/types";
import { APIService } from "../api.service";

type TConversationErrorResponse = {
  detail?: string;
  error?: string;
  message?: string;
};

export class ConversationRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ConversationRequestError";
    this.status = status;
  }

  static unknown() {
    return new ConversationRequestError("conversation_unavailable");
  }

  static from(error: unknown) {
    const response = (error as { response?: { data?: TConversationErrorResponse; status?: number } })?.response;
    const data = response?.data;
    return new ConversationRequestError(
      data?.detail ?? data?.error ?? data?.message ?? "conversation_request_failed",
      response?.status ?? 0
    );
  }
}

export class ConversationService extends APIService {
  constructor(baseUrl?: string) {
    super(baseUrl || API_BASE_URL);
  }

  async listChannels(workspaceSlug: string): Promise<IConversationChannel[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/channels/`)
      .then((response) => response.data)
      .catch((error) => {
        throw ConversationRequestError.from(error);
      });
  }

  async createChannel(workspaceSlug: string, name: string): Promise<IConversationChannel> {
    return this.post(`/api/workspaces/${workspaceSlug}/channels/`, { name })
      .then((response) => response.data)
      .catch((error) => {
        throw ConversationRequestError.from(error);
      });
  }

  async listMessages(channelId: string, cursor?: string): Promise<IConversationMessagePage> {
    return this.get(`/api/channels/${channelId}/messages/`, { params: cursor ? { cursor } : {} })
      .then((response) => response.data)
      .catch((error) => {
        throw ConversationRequestError.from(error);
      });
  }

  async listThread(channelId: string, rootId: string, cursor?: string): Promise<IConversationMessagePage> {
    return this.get(`/api/channels/${channelId}/threads/${rootId}/messages/`, {
      params: cursor ? { cursor } : {},
    })
      .then((response) => response.data)
      .catch((error) => {
        throw ConversationRequestError.from(error);
      });
  }

  async sendMessage(channelId: string, data: IConversationMessageInput): Promise<IConversationMessage> {
    return this.post(`/api/channels/${channelId}/messages/`, data)
      .then((response) => response.data)
      .catch((error) => {
        throw ConversationRequestError.from(error);
      });
  }

  async createAttachment(
    channelId: string,
    data: { name: string; mime_type: string; size: number }
  ): Promise<IConversationAttachmentUploadResponse> {
    return this.post(`/api/channels/${channelId}/attachments/`, data)
      .then((response) => response.data)
      .catch((error) => {
        throw ConversationRequestError.from(error);
      });
  }

  async confirmAttachment(channelId: string, assetId: string): Promise<IConversationAttachment> {
    return this.patch(`/api/channels/${channelId}/attachments/${assetId}/`)
      .then((response) => response.data)
      .catch((error) => {
        throw ConversationRequestError.from(error);
      });
  }

  async deleteAttachment(channelId: string, assetId: string): Promise<void> {
    return this.delete(`/api/channels/${channelId}/attachments/${assetId}/`)
      .then(() => undefined)
      .catch((error) => {
        throw ConversationRequestError.from(error);
      });
  }
}

export const conversationService = new ConversationService();
