/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { TWorkMapFile, TWorkMapFiles } from "@plane/types";

export type TStoredScene = {
  elements: readonly ExcalidrawElement[];
  files: TWorkMapFiles;
};

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

export const getNodeKey = (element: Pick<ExcalidrawElement, "type" | "customData">): string | undefined => {
  const nodeKey = element.type === "embeddable" ? element.customData?.nodeKey : undefined;
  return typeof nodeKey === "string" && NODE_KEY_PATTERN.test(nodeKey) ? nodeKey : undefined;
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
  const elements = scene.elements.map((element) => {
    const nodeKey = getNodeKey(element);
    return nodeKey
      ? { ...element, link: `https://work-map.invalid/nodes/${nodeKey}`, customData: { nodeKey } }
      : element;
  });
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
    throw new Error("Invalid Work Map scene");
  }
  const rawFiles = "files" in parsed ? parsed.files : {};
  if (!rawFiles || typeof rawFiles !== "object" || Array.isArray(rawFiles)) throw new Error("Invalid Work Map files");
  const files = Object.fromEntries(
    Object.entries(rawFiles).map(([fileId, file]) => {
      if (!fileId || !file || typeof file !== "object" || Array.isArray(file)) throw new Error("Invalid Work Map file");
      const keys = Object.keys(file);
      if (keys.length !== 3 || !keys.includes("assetId") || !keys.includes("mimeType") || !keys.includes("created"))
        throw new Error("Invalid Work Map file");
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
        throw new Error("Invalid Work Map file");
      return [fileId, { assetId, mimeType: mimeType as TWorkMapFile["mimeType"], created }];
    })
  );
  return { elements: parsed.elements as ExcalidrawElement[], files };
};

export const isGenerationConflict = (error: unknown): boolean =>
  !!error &&
  typeof error === "object" &&
  "response" in error &&
  (error.response as { status?: number } | undefined)?.status === 409;
