/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { TWorkMapFile, TWorkMapFiles, TWorkMapScene } from "@plane/types";

export type TStoredScene = {
  elements: readonly ExcalidrawElement[];
  files: TWorkMapFiles;
};

export type TSceneAuthority = Pick<TWorkMapScene, "generation" | "collaboration_epoch">;

export type TWorkMapRuntimeFile = BinaryFileData & { assetId?: string };
export type TWorkMapRuntimeFiles = Record<string, TWorkMapRuntimeFile>;

const NODE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_ID_PATTERN = NODE_KEY_PATTERN;
const IMAGE_MIME_TYPES = new Set<TWorkMapFile["mimeType"]>([
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/x-icon",
  "image/avif",
  "image/jfif",
]);

export const isWorkMapImageMimeType = (value: string): value is TWorkMapFile["mimeType"] =>
  IMAGE_MIME_TYPES.has(value as TWorkMapFile["mimeType"]);

const getCustomDataNodeKey = (element: Pick<ExcalidrawElement, "customData">): string | undefined => {
  const nodeKey = element.customData?.nodeKey;
  return typeof nodeKey === "string" && NODE_KEY_PATTERN.test(nodeKey) ? nodeKey : undefined;
};

export const getWorkMapFileMetadata = (file: TWorkMapRuntimeFile): TWorkMapFile | undefined => {
  if (
    typeof file.assetId !== "string" ||
    !ASSET_ID_PATTERN.test(file.assetId) ||
    !isWorkMapImageMimeType(file.mimeType) ||
    !Number.isInteger(file.created) ||
    file.created < 0
  ) {
    return undefined;
  }
  return { assetId: file.assetId, mimeType: file.mimeType, created: file.created };
};

export const addWorkMapAssetMetadata = (files: BinaryFiles, metadata: TWorkMapFiles): TWorkMapRuntimeFiles =>
  Object.fromEntries(
    Object.entries(files).map(([fileId, file]) => {
      const workMapFile = metadata[fileId];
      return [fileId, workMapFile ? { ...file, assetId: workMapFile.assetId } : file];
    })
  );

export const getNodeKey = (element: Pick<ExcalidrawElement, "type" | "customData">): string | undefined => {
  return element.type === "rectangle" ? getCustomDataNodeKey(element) : undefined;
};

const NODE_CARRIER_HIT_AREA = "rgba(0, 0, 0, 0.001)";

export const normalizeNodeCarrier = (element: ExcalidrawElement): ExcalidrawElement => {
  if (element.type !== "rectangle" && element.type !== "embeddable") return element;
  const nodeKey = getCustomDataNodeKey(element);
  if (!nodeKey) return element;
  return {
    ...element,
    type: "rectangle",
    link: null,
    // Excalidraw only hit-tests the interior of a filled shape. The host card
    // covers this imperceptible fill while preserving native whole-card selection.
    backgroundColor: NODE_CARRIER_HIT_AREA,
    customData: { nodeKey },
  };
};

export const isAllowedEmbedUrl = (link: string): boolean => {
  try {
    const protocol = new URL(link).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

export const encodeScene = (scene: TStoredScene): string => {
  // Native elements use null; restoration uses []. Keep equivalent bindings byte-stable for save acknowledgements.
  const elements = scene.elements.map((element) =>
    normalizeNodeCarrier({ ...element, boundElements: element.boundElements ?? [] })
  );
  const files = Object.fromEntries(
    Object.entries(scene.files).map(([fileId, file]) => [
      fileId,
      { assetId: file.assetId, mimeType: file.mimeType, created: file.created },
    ])
  );
  const json = JSON.stringify({ elements, files });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
};

export const decodeScene = (value: string): TStoredScene => {
  if (!value) return { elements: [], files: {} };
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== "object" || !("elements" in parsed) || !Array.isArray(parsed.elements)) {
    throw new Error("Invalid Work map scene");
  }
  const rawFiles = "files" in parsed ? parsed.files : {};
  if (!rawFiles || typeof rawFiles !== "object" || Array.isArray(rawFiles)) throw new Error("Invalid Work map files");
  const files = Object.fromEntries(
    Object.entries(rawFiles).map(([fileId, file]) => {
      if (!fileId || !file || typeof file !== "object" || Array.isArray(file)) throw new Error("Invalid Work map file");
      const keys = Object.keys(file);
      if (keys.length !== 3 || !keys.includes("assetId") || !keys.includes("mimeType") || !keys.includes("created"))
        throw new Error("Invalid Work map file");
      const { assetId, mimeType, created } = file as Record<string, unknown>;
      if (
        typeof assetId !== "string" ||
        !ASSET_ID_PATTERN.test(assetId) ||
        typeof mimeType !== "string" ||
        !IMAGE_MIME_TYPES.has(mimeType as TWorkMapFile["mimeType"]) ||
        typeof created !== "number" ||
        !Number.isInteger(created) ||
        created < 0
      )
        throw new Error("Invalid Work map file");
      return [fileId, { assetId, mimeType: mimeType as TWorkMapFile["mimeType"], created }];
    })
  );
  return { elements: (parsed.elements as ExcalidrawElement[]).map(normalizeNodeCarrier), files };
};

export const isGenerationConflict = (error: unknown): boolean =>
  !!error &&
  typeof error === "object" &&
  "response" in error &&
  (error.response as { status?: number } | undefined)?.status === 409;

export const isSceneSerializationCancelled = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

const TRANSIENT_NETWORK_CODES = new Set(["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT"]);

export const isTransientPersistenceFailure = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  if (error instanceof TypeError) return true;
  const response = "response" in error ? error.response : undefined;
  const status =
    response && typeof response === "object" && "status" in response ? (response.status as unknown) : undefined;
  if (typeof status === "number") return status >= 500;
  const code = "code" in error ? error.code : undefined;
  return typeof code === "string" ? TRANSIENT_NETWORK_CODES.has(code) : "request" in error;
};
