/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TFileSignedURLResponse } from "./file";

export type IConversationChannel = {
  id: string;
  name: string;
  created_at: string;
};

export type IConversationAuthor = {
  id: string;
  display_name: string;
  avatar_url?: string | null;
};

export type IConversationAttachment = {
  asset_id: string;
  name: string;
  mime_type: string;
  size: number;
  asset_url: string;
  is_uploaded: boolean;
};

export type IConversationAttachmentUploadResponse = {
  asset: IConversationAttachment;
  upload_data: TFileSignedURLResponse["upload_data"];
};

export type TConversationCreationOrigin = {
  kind: "conversation";
  channel_id: string;
  thread_root_id: string | null;
};

export type TConversationCreatedWorkItem = {
  id: string;
  project_id: string;
  name: string;
};

export type IConversationMessage = {
  id: string;
  channel_id: string;
  parent_id: string | null;
  root_id: string | null;
  content: string;
  client_id: string;
  created_at: string;
  author: IConversationAuthor;
  reply_count: number;
  attachments: IConversationAttachment[];
  created_work_item: TConversationCreatedWorkItem | null;
};

export type IConversationMessagePage = {
  results: IConversationMessage[];
  next_cursor: string | null;
};

export type IConversationMessageInput = {
  content: string;
  parent_id: string | null;
  client_id: string;
  attachment_ids: string[];
};
