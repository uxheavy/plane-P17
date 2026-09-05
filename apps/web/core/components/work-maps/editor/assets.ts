/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { BinaryFileData, BinaryFiles, DataURL } from "@excalidraw/excalidraw/types";
import { MIME_TYPES } from "@excalidraw/excalidraw";
import type { TWorkMapFile, TWorkMapFiles } from "@plane/types";
import { FileService } from "@/services/file.service";

const extensionByMimeType: Record<TWorkMapFile["mimeType"], string> = {
  [MIME_TYPES.svg]: "svg",
  [MIME_TYPES.png]: "png",
  [MIME_TYPES.jpg]: "jpeg",
  "image/gif": "gif",
  [MIME_TYPES.webp]: "webp",
  [MIME_TYPES.bmp]: "bmp",
  [MIME_TYPES.ico]: "ico",
  [MIME_TYPES.avif]: "avif",
  [MIME_TYPES.jfif]: "jfif",
};

const isWorkMapImageMimeType = (value: string): value is TWorkMapFile["mimeType"] => value in extensionByMimeType;

const blobToDataUrl = (blob: Blob): Promise<DataURL> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as DataURL));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });

export const materializeFiles = async (
  service: FileService,
  workspaceSlug: string,
  projectId: string,
  workMapId: string,
  files: TWorkMapFiles
): Promise<{ files: BinaryFiles; failures: Array<{ fileId: string; error: unknown }> }> => {
  const entries = Object.entries(files);
  const results = await Promise.allSettled(
    entries.map(async ([fileId, file]) => {
      const blob = await service.fetchWorkMapSceneAsset(workspaceSlug, projectId, workMapId, file.assetId);
      const data: BinaryFileData = {
        id: fileId as BinaryFileData["id"],
        mimeType: file.mimeType,
        created: file.created,
        dataURL: await blobToDataUrl(blob),
        lastRetrieved: Date.now(),
      };
      return [fileId, data] as const;
    })
  );
  return {
    files: Object.fromEntries(results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))),
    failures: results.flatMap((result, index) =>
      result.status === "rejected" ? [{ fileId: entries[index][0], error: result.reason as unknown }] : []
    ),
  };
};

export const uploadFile = async (
  service: FileService,
  workspaceSlug: string,
  projectId: string,
  workMapId: string,
  fileId: string,
  file: BinaryFileData
): Promise<TWorkMapFile> => {
  if (!isWorkMapImageMimeType(file.mimeType)) throw new Error("Unsupported Work map image type");
  const blob = await fetch(file.dataURL).then((response) => {
    if (!response.ok) throw new Error("Unable to read Work map image");
    return response.blob();
  });
  const upload = new File([blob], `${fileId}.${extensionByMimeType[file.mimeType]}`, {
    type: file.mimeType,
  });
  const asset = await service.uploadWorkMapSceneAsset(workspaceSlug, projectId, workMapId, upload);
  if (!isWorkMapImageMimeType(asset.mime_type)) throw new Error("Unsupported Work map image type");
  return {
    assetId: asset.asset_id,
    mimeType: asset.mime_type,
    created: file.created,
  };
};
