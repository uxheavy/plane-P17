/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { AxiosRequestConfig } from "axios";
// plane types
import { API_BASE_URL } from "@plane/constants";
import { getFileMetaDataForUpload, generateFileUploadPayload } from "@plane/services";
import type {
  EFileAssetType,
  TFileEntityInfo,
  TFileSignedURLResponse,
  TWorkMapSceneAsset,
  TWorkMapSceneAssetUploadResponse,
} from "@plane/types";
import { getAssetIdFromUrl } from "@plane/utils";
// helpers
// services
import { APIService } from "@/services/api.service";
import { FileUploadService } from "@/services/file-upload.service";

export interface UnSplashImage {
  id: string;
  created_at: Date;
  updated_at: Date;
  promoted_at: Date;
  width: number;
  height: number;
  color: string;
  blur_hash: string;
  description: null;
  alt_description: string;
  urls: UnSplashImageUrls;
  [key: string]: any;
}

export interface UnSplashImageUrls {
  raw: string;
  full: string;
  regular: string;
  small: string;
  thumb: string;
  small_s3: string;
}

export enum TFileAssetType {
  COMMENT_DESCRIPTION = "COMMENT_DESCRIPTION",
  ISSUE_ATTACHMENT = "ISSUE_ATTACHMENT",
  ISSUE_DESCRIPTION = "ISSUE_DESCRIPTION",
  PAGE_DESCRIPTION = "PAGE_DESCRIPTION",
  PROJECT_COVER = "PROJECT_COVER",
  USER_AVATAR = "USER_AVATAR",
  USER_COVER = "USER_COVER",
  WORKSPACE_LOGO = "WORKSPACE_LOGO",
}

export class FileService extends APIService {
  private cancelSource: any;
  private fileUploadService: FileUploadService;

  constructor() {
    super(API_BASE_URL);
    this.cancelUpload = this.cancelUpload.bind(this);
    // upload service
    this.fileUploadService = new FileUploadService();
  }

  private workMapSceneAssetPath(workspaceSlug: string, projectId: string, workMapId: string, suffix = "") {
    return `/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/work-maps/${workMapId}/scene-assets/${suffix}`;
  }

  async uploadWorkMapSceneAsset(
    workspaceSlug: string,
    projectId: string,
    workMapId: string,
    file: File
  ): Promise<TWorkMapSceneAsset> {
    const metadata = await getFileMetaDataForUpload(file);
    const upload = await this.post(this.workMapSceneAssetPath(workspaceSlug, projectId, workMapId), {
      name: metadata.name,
      mime_type: metadata.type,
      size: metadata.size,
    }).then(({ data }) => data as TWorkMapSceneAssetUploadResponse);
    const uploadPayload = generateFileUploadPayload(
      {
        asset_id: upload.asset.asset_id,
        asset_url: upload.asset.asset_url,
        upload_data: upload.upload_data,
      },
      file
    );
    await this.fileUploadService.uploadFile(upload.upload_data.url, uploadPayload);
    return this.patch(
      this.workMapSceneAssetPath(workspaceSlug, projectId, workMapId, `${upload.asset.asset_id}/`)
    ).then(({ data }) => data);
  }

  async fetchWorkMapSceneAsset(
    workspaceSlug: string,
    projectId: string,
    workMapId: string,
    assetId: string
  ): Promise<Blob> {
    return this.get(
      this.workMapSceneAssetPath(workspaceSlug, projectId, workMapId, `${assetId}/`),
      {},
      {
        responseType: "blob",
      }
    ).then(({ data }) => data);
  }

  private async updateWorkspaceAssetUploadStatus(workspaceSlug: string, assetId: string): Promise<void> {
    return this.patch(`/api/assets/v2/workspaces/${workspaceSlug}/${assetId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async uploadWorkspaceAsset(
    workspaceSlug: string,
    data: TFileEntityInfo,
    file: File,
    uploadProgressHandler?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<TFileSignedURLResponse> {
    const fileMetaData = await getFileMetaDataForUpload(file);
    return this.post(`/api/assets/v2/workspaces/${workspaceSlug}/`, {
      ...data,
      ...fileMetaData,
    })
      .then(async (response) => {
        const signedURLResponse: TFileSignedURLResponse = response?.data;
        const fileUploadPayload = generateFileUploadPayload(signedURLResponse, file);
        await this.fileUploadService.uploadFile(
          signedURLResponse.upload_data.url,
          fileUploadPayload,
          uploadProgressHandler
        );
        await this.updateWorkspaceAssetUploadStatus(workspaceSlug.toString(), signedURLResponse.asset_id);
        return signedURLResponse;
      })
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteWorkspaceAsset(workspaceSlug: string, assetId: string): Promise<void> {
    return this.delete(`/api/assets/v2/workspaces/${workspaceSlug}/${assetId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  private async updateProjectAssetUploadStatus(
    workspaceSlug: string,
    projectId: string,
    assetId: string
  ): Promise<void> {
    return this.patch(`/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/${assetId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateBulkWorkspaceAssetsUploadStatus(
    workspaceSlug: string,
    entityId: string,
    data: {
      asset_ids: string[];
    }
  ): Promise<void> {
    return this.post(`/api/assets/v2/workspaces/${workspaceSlug}/${entityId}/bulk/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateBulkProjectAssetsUploadStatus(
    workspaceSlug: string,
    projectId: string,
    entityId: string,
    data: {
      asset_ids: string[];
    }
  ): Promise<void> {
    return this.post(`/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/${entityId}/bulk/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async uploadProjectAsset(
    workspaceSlug: string,
    projectId: string,
    data: TFileEntityInfo,
    file: File,
    uploadProgressHandler?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<TFileSignedURLResponse> {
    const fileMetaData = await getFileMetaDataForUpload(file);
    return this.post(`/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/`, {
      ...data,
      ...fileMetaData,
    })
      .then(async (response) => {
        const signedURLResponse: TFileSignedURLResponse = response?.data;
        const fileUploadPayload = generateFileUploadPayload(signedURLResponse, file);
        await this.fileUploadService.uploadFile(
          signedURLResponse.upload_data.url,
          fileUploadPayload,
          uploadProgressHandler
        );
        await this.updateProjectAssetUploadStatus(workspaceSlug, projectId, signedURLResponse.asset_id);
        return signedURLResponse;
      })
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  private async updateUserAssetUploadStatus(assetId: string): Promise<void> {
    return this.patch(`/api/assets/v2/user-assets/${assetId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async uploadUserAsset(data: TFileEntityInfo, file: File): Promise<TFileSignedURLResponse> {
    const fileMetaData = await getFileMetaDataForUpload(file);
    return this.post(`/api/assets/v2/user-assets/`, {
      ...data,
      ...fileMetaData,
    })
      .then(async (response) => {
        const signedURLResponse: TFileSignedURLResponse = response?.data;
        const fileUploadPayload = generateFileUploadPayload(signedURLResponse, file);
        await this.fileUploadService.uploadFile(signedURLResponse.upload_data.url, fileUploadPayload);
        await this.updateUserAssetUploadStatus(signedURLResponse.asset_id);
        return signedURLResponse;
      })
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteUserAsset(assetId: string): Promise<void> {
    return this.delete(`/api/assets/v2/user-assets/${assetId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteNewAsset(assetPath: string): Promise<void> {
    return this.delete(assetPath)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteOldWorkspaceAsset(workspaceId: string, src: string): Promise<any> {
    const assetKey = getAssetIdFromUrl(src);
    return this.delete(`/api/workspaces/file-assets/${workspaceId}/${assetKey}/`)
      .then((response) => response?.status)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteOldUserAsset(src: string): Promise<any> {
    const assetKey = getAssetIdFromUrl(src);
    return this.delete(`/api/users/file-assets/${assetKey}/`)
      .then((response) => response?.status)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async restoreNewAsset(workspaceSlug: string, src: string): Promise<void> {
    // remove the last slash and get the asset id
    const assetId = getAssetIdFromUrl(src);
    return this.post(`/api/assets/v2/workspaces/${workspaceSlug}/restore/${assetId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async checkIfAssetExists(
    workspaceSlug: string,
    assetId: string
  ): Promise<{
    exists: boolean;
  }> {
    return this.get(`/api/assets/v2/workspaces/${workspaceSlug}/check/${assetId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async restoreOldEditorAsset(workspaceId: string, src: string): Promise<void> {
    const assetKey = getAssetIdFromUrl(src);
    return this.post(`/api/workspaces/file-assets/${workspaceId}/${assetKey}/restore/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  cancelUpload() {
    this.cancelSource.cancel("Upload canceled");
  }

  async getUnsplashImages(query?: string): Promise<UnSplashImage[]> {
    return this.get(`/api/unsplash/`, {
      params: {
        query,
      },
    })
      .then((res) => res?.data?.results ?? res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async duplicateAsset(
    workspaceSlug: string,
    assetId: string,
    data: {
      entity_id?: string;
      entity_type: EFileAssetType;
      project_id?: string;
    }
  ): Promise<{ asset_id: string }> {
    return this.post(`/api/assets/v2/workspaces/${workspaceSlug}/duplicate-assets/${assetId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
