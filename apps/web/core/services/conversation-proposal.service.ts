/**
 * Copyright (c) 2026-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type TConversationProposalStatus = "accepted" | "processing" | "completed" | "failed";

export type TConversationProposalRequest = {
  request_id: string;
  agent_user_id: string;
  thread_id: string | null;
};

export type TConversationProposalResult = {
  title: string;
  description_markdown: string;
};

export type TConversationProposalResponse =
  | {
      request_id: string;
      status: "accepted" | "processing";
    }
  | {
      request_id: string;
      status: "completed";
      result: TConversationProposalResult;
    }
  | {
      request_id: string;
      status: "failed";
      error: string;
    };

export class ConversationProposalUncertainError extends Error {
  readonly requestId: string;

  constructor(requestId: string) {
    super("conversation_proposal_status_uncertain");
    this.name = "ConversationProposalUncertainError";
    this.requestId = requestId;
  }
}

class ConversationProposalService extends APIService {
  private getPath(channelId: string) {
    return `/api/channels/${channelId}/conversation-proposals/`;
  }

  async submit(channelId: string, request: TConversationProposalRequest): Promise<TConversationProposalResponse> {
    return this.post(this.getPath(channelId), request).then((response) => response.data);
  }

  async read(channelId: string, request: TConversationProposalRequest): Promise<TConversationProposalResponse> {
    return this.get(this.getPath(channelId), { params: request }).then((response) => response.data);
  }
}

const conversationProposalService = new ConversationProposalService(API_BASE_URL);

export const getConversationProposalHttpStatus = (error: unknown): number | undefined => {
  const typedError = error as { response?: { status?: unknown }; status?: unknown };
  const status = typedError?.response?.status ?? typedError?.status;
  return typeof status === "number" ? status : undefined;
};

export const isDefinitiveConversationProposalError = (error: unknown): boolean => {
  const status = getConversationProposalHttpStatus(error);
  return status !== undefined && [400, 401, 403, 404, 405, 413, 415, 422].includes(status);
};

export async function requestConversationProposal(
  channelId: string,
  request: TConversationProposalRequest
): Promise<TConversationProposalResponse> {
  try {
    return await conversationProposalService.submit(channelId, request);
  } catch (submitError) {
    if (isDefinitiveConversationProposalError(submitError)) throw submitError;
    try {
      return await conversationProposalService.read(channelId, request);
    } catch {
      // Once POST acceptance is uncertain, a GET failure cannot prove that the
      // signed request was not accepted. Keep the UUID for a later read.
      throw new ConversationProposalUncertainError(request.request_id);
    }
  }
}

export function readConversationProposal(
  channelId: string,
  request: TConversationProposalRequest
): Promise<TConversationProposalResponse> {
  return conversationProposalService.read(channelId, request);
}
