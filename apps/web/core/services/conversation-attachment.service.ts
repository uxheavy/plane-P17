/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { AxiosRequestConfig } from "axios";
import { generateFileUploadPayload, getFileMetaDataForUpload } from "@plane/services";
import type { IConversationAttachment } from "@plane/types";
import { conversationService } from "@plane/services";
import { FileUploadService } from "@/services/file-upload.service";

export class ConversationAttachmentService {
  private readonly fileUploadService = new FileUploadService();

  async upload(
    channelId: string,
    file: File,
    onUploadProgress?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<IConversationAttachment> {
    const metadata = await getFileMetaDataForUpload(file);
    const mimeType = metadata.type || file.type;
    if (!mimeType) throw new Error("attachment_type_missing");

    const response = await conversationService.createAttachment(channelId, {
      name: metadata.name,
      mime_type: mimeType,
      size: metadata.size,
    });
    await this.fileUploadService.uploadFile(
      response.upload_data.url,
      generateFileUploadPayload({ ...response.asset, upload_data: response.upload_data }, file),
      onUploadProgress
    );
    return conversationService.confirmAttachment(channelId, response.asset.asset_id);
  }

  delete(channelId: string, assetId: string) {
    return conversationService.deleteAttachment(channelId, assetId);
  }
}

export const conversationAttachmentService = new ConversationAttachmentService();
