/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ClipboardData } from "@excalidraw/excalidraw/clipboard";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { TWorkMapFiles } from "@plane/types";
import { getNodeKey, getWorkMapFileMetadata, type TWorkMapRuntimeFile, type TWorkMapRuntimeFiles } from "./scene";

const isProtectedCarrier = (element: ExcalidrawElement) =>
  element.type === "rectangle" && typeof getNodeKey(element) === "string";

const collectNodeKeys = (elements: readonly ExcalidrawElement[]) => {
  const keys: string[] = [];
  for (const element of elements) {
    const nodeKey = getNodeKey(element);
    if (nodeKey) keys.push(nodeKey);
  }
  return new Set(keys);
};

type TWorkMapPasteRebinding = {
  node_keys: Record<string, string>;
  files: Record<string, string>;
};

type TWorkMapPasteFiles = {
  workMapFiles: TWorkMapFiles;
  hasUnownedFiles: boolean;
  hasInvalidMetadata: boolean;
};

const collectWorkMapFiles = (data: ClipboardData): TWorkMapPasteFiles => {
  const workMapFiles: TWorkMapFiles = {};
  let hasUnownedFiles = false;
  let hasInvalidMetadata = false;
  for (const [fileId, file] of Object.entries(data.files ?? {})) {
    const runtimeFile = file as TWorkMapRuntimeFile;
    if (runtimeFile.assetId === undefined) {
      hasUnownedFiles = true;
      continue;
    }
    const metadata = getWorkMapFileMetadata(runtimeFile);
    if (!metadata) {
      hasInvalidMetadata = true;
      continue;
    }
    workMapFiles[fileId] = metadata;
  }
  return { workMapFiles, hasUnownedFiles, hasInvalidMetadata };
};

export const allowPaste = (
  data: ClipboardData,
  currentElements: readonly ExcalidrawElement[]
): ClipboardData | false => {
  if (!data.elements?.some(isProtectedCarrier)) return data;

  const currentNodeKeys = new Set(currentElements.map(getNodeKey).filter((nodeKey): nodeKey is string => !!nodeKey));
  for (const element of data.elements) {
    if (!isProtectedCarrier(element)) continue;
    const nodeKey = getNodeKey(element);
    if (!nodeKey || !currentNodeKeys.has(nodeKey)) return false;
  }
  return data;
};

export const rebindProtectedPaste = async (
  data: ClipboardData,
  currentElements: readonly ExcalidrawElement[],
  rebind: (nodeKeys: string[], files: TWorkMapFiles) => Promise<TWorkMapPasteRebinding>,
  currentFiles: TWorkMapRuntimeFiles = {}
): Promise<ClipboardData | false> => {
  const hasProtectedCarriers = data.elements?.some(isProtectedCarrier) ?? false;
  const currentNodeKeys = collectNodeKeys(currentElements);
  const pastedNodeKeys = [...collectNodeKeys((data.elements ?? []).filter(isProtectedCarrier))];
  const { workMapFiles, hasUnownedFiles, hasInvalidMetadata } = collectWorkMapFiles(data);
  if (hasInvalidMetadata || (hasProtectedCarriers && hasUnownedFiles)) return false;
  if (!hasProtectedCarriers && Object.keys(workMapFiles).length === 0) return data;

  const nodeKeysToRebind = pastedNodeKeys.filter((nodeKey) => !currentNodeKeys.has(nodeKey));
  if (nodeKeysToRebind.length === 0 && Object.keys(workMapFiles).length === 0) return data;

  const result = await rebind(nodeKeysToRebind, workMapFiles);
  for (const nodeKey of nodeKeysToRebind) {
    if (!result.node_keys[nodeKey]) throw new Error("Work map paste rebinding was incomplete");
  }
  for (const fileId of Object.keys(workMapFiles)) {
    if (!result.files[fileId]) throw new Error("Work map asset rebinding was incomplete");
  }

  const fileIdMap = new Map<string, string>();
  const occupiedFileIds = new Set([...Object.keys(currentFiles), ...Object.keys(data.files ?? {})]);
  for (const fileId of Object.keys(workMapFiles)) {
    const currentFile = currentFiles[fileId];
    const currentMetadata = currentFile ? getWorkMapFileMetadata(currentFile) : undefined;
    const targetAssetId = result.files[fileId];
    if (currentFile && currentMetadata?.assetId !== targetAssetId) {
      let nextFileId = crypto.randomUUID();
      while (occupiedFileIds.has(nextFileId)) nextFileId = crypto.randomUUID();
      occupiedFileIds.add(nextFileId);
      fileIdMap.set(fileId, nextFileId);
    }
  }

  const elements = data.elements?.map((element) => {
    const sourceFileId = "fileId" in element && typeof element.fileId === "string" ? element.fileId : undefined;
    const reboundFileId = sourceFileId ? fileIdMap.get(sourceFileId) : undefined;
    const fileReboundElement = reboundFileId
      ? ({ ...element, fileId: reboundFileId as TWorkMapRuntimeFile["id"] } as ExcalidrawElement)
      : element;
    if (!isProtectedCarrier(fileReboundElement)) return fileReboundElement;
    const nodeKey = getNodeKey(fileReboundElement);
    const reboundNodeKey = nodeKey
      ? (result.node_keys[nodeKey] ?? (currentNodeKeys.has(nodeKey) ? nodeKey : undefined))
      : undefined;
    if (!reboundNodeKey) throw new Error("Work map paste rebinding was incomplete");
    return { ...fileReboundElement, customData: { nodeKey: reboundNodeKey } };
  });
  const files = data.files
    ? Object.fromEntries(
        Object.entries(data.files).map(([fileId, file]) => {
          const targetAssetId = result.files[fileId];
          const reboundFileId = fileIdMap.get(fileId) ?? fileId;
          return [
            reboundFileId,
            targetAssetId ? { ...file, id: reboundFileId as TWorkMapRuntimeFile["id"], assetId: targetAssetId } : file,
          ];
        })
      )
    : undefined;
  return { ...data, ...(elements ? { elements } : {}), ...(files ? { files } : {}) };
};
