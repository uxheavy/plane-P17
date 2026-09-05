/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { TWorkMapFiles } from "@plane/types";
import {
  decodeScene,
  encodeScene,
  getNodeKey,
  isAllowedEmbedUrl,
  isGenerationConflict,
  isTransientPersistenceFailure,
} from "./scene";

describe("Work map scene boundary", () => {
  it("keeps materialized images when a sibling asset fetch fails", async () => {
    vi.resetModules();
    vi.doMock("@excalidraw/excalidraw", () => ({
      MIME_TYPES: {
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        webp: "image/webp",
        bmp: "image/bmp",
        ico: "image/x-icon",
        avif: "image/avif",
        jfif: "image/jfif",
      },
    }));
    const load = vi.fn();
    class TestFileReader {
      result: string | null = null;
      error: Error | null = null;

      addEventListener(event: string, listener: () => void) {
        if (event === "load") load.mockImplementation(listener);
      }

      readAsDataURL() {
        this.result = "data:image/png;base64,AA==";
        load();
      }
    }
    vi.stubGlobal("FileReader", TestFileReader);
    const service = {
      fetchWorkMapSceneAsset: vi.fn((_workspaceSlug: string, _projectId: string, _workMapId: string, assetId: string) =>
        assetId.startsWith("d0") ? Promise.resolve(new Blob(["image"])) : Promise.reject({ code: "ERR_NETWORK" })
      ),
    } as never;

    try {
      const { materializeFiles } = await import("./assets");
      const result = await materializeFiles(service, "workspace", "project", "map", {
        available: {
          assetId: "d0f238c8-1c14-4f6c-a695-70d087bb8db0",
          mimeType: "image/png",
          created: 1,
        },
        unavailable: {
          assetId: "f0f238c8-1c14-4f6c-a695-70d087bb8db0",
          mimeType: "image/png",
          created: 2,
        },
      });

      expect(result.files.available?.dataURL).toBe("data:image/png;base64,AA==");
      expect(result.failures).toEqual([{ fileId: "unavailable", error: { code: "ERR_NETWORK" } }]);
    } finally {
      vi.doUnmock("@excalidraw/excalidraw");
      vi.resetModules();
      vi.unstubAllGlobals();
    }
  });

  it("serializes empty native bindings consistently before and after restoration", () => {
    const element = { id: "rectangle", type: "rectangle", boundElements: null } as unknown as ExcalidrawElement;
    const restored = { ...element, boundElements: [] };
    expect(encodeScene({ elements: [element], files: {} })).toBe(encodeScene({ elements: [restored], files: {} }));
    expect(element.boundElements).toBeNull();
    const bound = { ...element, boundElements: [{ id: "label", type: "text" as const }] };
    expect(decodeScene(encodeScene({ elements: [bound], files: {} })).elements[0].boundElements).toEqual(
      bound.boundElements
    );
  });

  it("accepts only web embed URLs", () => {
    expect(isAllowedEmbedUrl("https://example.com/path")).toBe(true);
    expect(isAllowedEmbedUrl("http://127.0.0.1:8080/frame")).toBe(true);
    expect(isAllowedEmbedUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedEmbedUrl("not a URL")).toBe(false);
  });

  it("round-trips native rectangle carriers with only the opaque node key", () => {
    const nodeKey = "d0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const element = {
      id: "carrier",
      type: "rectangle",
      link: "https://work-map.invalid/nodes/legacy",
      customData: { nodeKey, source_id: "must-not-survive", source_kind: "work-item" },
    } as unknown as ExcalidrawElement;
    const encoded = encodeScene({ elements: [element], files: {} });
    const decoded = decodeScene(encoded);
    expect(getNodeKey(decoded.elements[0])).toBe(nodeKey);
    expect(decoded.elements[0]).toMatchObject({
      type: "rectangle",
      backgroundColor: "rgba(0, 0, 0, 0.001)",
      customData: { nodeKey },
    });
    expect(decoded.elements[0].link).toBeNull();
    expect(atob(encoded)).not.toContain("source_id");
    expect(atob(encoded)).not.toContain("source_kind");
    expect(atob(encoded)).not.toContain("must-not-survive");
  });

  it("rejects viewer-local asset bytes at the durable scene boundary", () => {
    const encoded = btoa(
      JSON.stringify({
        elements: [],
        files: {
          image: {
            assetId: "d0f238c8-1c14-4f6c-a695-70d087bb8db0",
            mimeType: "image/png",
            created: 1,
            dataURL: "data:image/png;base64,unsafe",
          },
        },
      })
    );
    expect(() => decodeScene(encoded)).toThrow("Invalid Work map file");
  });

  it("serializes only the closed Plane asset metadata", () => {
    const encoded = encodeScene({
      elements: [],
      files: {
        image: {
          assetId: "d0f238c8-1c14-4f6c-a695-70d087bb8db0",
          mimeType: "image/png",
          created: 1,
          dataURL: "data:image/png;base64,unsafe",
        },
      } as unknown as TWorkMapFiles,
    });
    expect(atob(encoded)).not.toContain("dataURL");
    expect(decodeScene(encoded).files.image).toEqual({
      assetId: "d0f238c8-1c14-4f6c-a695-70d087bb8db0",
      mimeType: "image/png",
      created: 1,
    });
  });

  it("classifies generation conflicts and transient persistence failures", () => {
    expect(isGenerationConflict({ response: { status: 409 } })).toBe(true);
    expect(isGenerationConflict({ response: { status: 403 } })).toBe(false);
    expect(isGenerationConflict(new Error("offline"))).toBe(false);
    expect(isTransientPersistenceFailure({ response: { status: 503 } })).toBe(true);
    expect(isTransientPersistenceFailure({ response: { status: 429 } })).toBe(false);
    expect(isTransientPersistenceFailure({ code: "ERR_NETWORK" })).toBe(true);
    expect(isTransientPersistenceFailure(new TypeError("offline"))).toBe(true);
    expect(isTransientPersistenceFailure(new Error("invalid scene"))).toBe(false);
  });

  it("retries transient reads and same-epoch CAS but stops at an authority error", async () => {
    vi.resetModules();
    vi.doMock("react", async () => {
      const actual = await vi.importActual<typeof import("react")>("react");
      return {
        ...actual,
        useCallback: (callback: unknown) => callback,
        useEffect: () => undefined,
        useMemo: (factory: () => unknown) => factory(),
        useRef: (current: unknown) => ({ current }),
        useState: (initial: unknown) => [
          typeof initial === "function" ? (initial as () => unknown)() : initial,
          vi.fn(),
        ],
      };
    });
    vi.doMock("./merge-authoritative-scene", () => ({
      mergeAuthoritativeScene: (sceneBinary: string) => ({ sceneBinary, elements: [], files: {} }),
    }));

    vi.useFakeTimers();
    const retainedSceneBinary = encodeScene({ elements: [], files: {} });
    const writtenAt = Date.now();
    const values = new Map<string, string>([
      [
        "work-map-recovery:user:map:old-writer",
        JSON.stringify({
          generation: 1,
          scene_binary: retainedSceneBinary,
          writtenAt,
          expiresAt: writtenAt + 86_400_000,
          writerId: "old-writer",
        }),
      ],
    ]);
    const localStorage = {
      get length() {
        return values.size;
      },
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    vi.stubGlobal("window", { localStorage, setTimeout, clearTimeout });
    vi.stubGlobal("devicePixelRatio", 1);

    try {
      const [{ usePersistence }, { WorkMapService }] = await Promise.all([
        import("./use-persistence"),
        import("@/services/work-map.service"),
      ]);
      const fetchScene = vi
        .spyOn(WorkMapService.prototype, "fetchScene")
        .mockRejectedValueOnce({ code: "ERR_NETWORK" })
        .mockResolvedValueOnce({
          collaboration_epoch: 2,
          generation: 1,
          scene_binary: encodeScene({ elements: [], files: {} }),
        })
        .mockResolvedValueOnce({
          collaboration_epoch: 2,
          generation: 1,
          scene_binary: encodeScene({ elements: [], files: {} }),
        })
        .mockResolvedValueOnce({
          collaboration_epoch: 2,
          generation: 1,
          scene_binary: encodeScene({ elements: [], files: {} }),
        });
      for (let attempt = 0; attempt < 10; attempt += 1) fetchScene.mockRejectedValueOnce({ code: "ERR_NETWORK" });
      fetchScene.mockResolvedValue({
        collaboration_epoch: 2,
        generation: 1,
        scene_binary: encodeScene({ elements: [], files: {} }),
      });
      const saveScene = vi
        .spyOn(WorkMapService.prototype, "saveScene")
        .mockRejectedValueOnce({ response: { status: 409 } })
        .mockResolvedValueOnce({ generation: 2 })
        .mockRejectedValueOnce({ response: { status: 403 } })
        .mockResolvedValueOnce({ generation: 3 });
      const applyRemoteScene = vi.fn().mockResolvedValue(undefined);
      const generationRef = { current: 1 };
      const collaborationEpochRef = { current: 2 };
      const persistence = usePersistence(
        { workspaceSlug: "workspace", projectId: "project", workMapId: "map", userId: "user" },
        {
          generationRef,
          collaborationEpochRef,
          durableSceneRef: { current: "" },
          getAppState: () => ({}) as never,
          applyRemoteScene,
          applyAuthoritativeScene: vi.fn().mockResolvedValue(undefined),
        }
      );
      expect(persistence.persistenceFailed).toBe(false);
      const sceneBinary = retainedSceneBinary;
      const nextSceneBinary = encodeScene({
        elements: [],
        files: {
          image: {
            assetId: "d0f238c8-1c14-4f6c-a695-70d087bb8db0",
            mimeType: "image/png",
            created: 1,
          },
        },
      });
      const blockedSceneBinary = encodeScene({
        elements: [],
        files: {
          image: {
            assetId: "f0f238c8-1c14-4f6c-a695-70d087bb8db0",
            mimeType: "image/png",
            created: 2,
          },
        },
      });

      expect(persistence.queue(sceneBinary, { generation: 1, collaboration_epoch: 2 })).toBe("queued");
      await vi.advanceTimersByTimeAsync(350);
      await vi.runAllTimersAsync();
      expect(fetchScene).toHaveBeenCalledTimes(3);
      expect(saveScene).toHaveBeenCalledTimes(2);
      expect(applyRemoteScene).toHaveBeenCalledTimes(1);

      expect(persistence.queue(nextSceneBinary, { generation: 2, collaboration_epoch: 2 })).toBe("queued");
      await vi.advanceTimersByTimeAsync(350);
      await vi.runAllTimersAsync();
      expect(fetchScene).toHaveBeenCalledTimes(4);
      expect(saveScene).toHaveBeenCalledTimes(3);

      expect(persistence.queue(blockedSceneBinary, { generation: 2, collaboration_epoch: 2 })).toBe("queued");
      await vi.advanceTimersByTimeAsync(350);
      await vi.runAllTimersAsync();
      expect(fetchScene).toHaveBeenCalledTimes(15);
      expect(saveScene).toHaveBeenCalledTimes(4);

      collaborationEpochRef.current = 3;
      expect(persistence.queue(nextSceneBinary, { generation: 2, collaboration_epoch: 2 })).toBe("blocked");
      expect(fetchScene).toHaveBeenCalledTimes(15);
      expect(saveScene).toHaveBeenCalledTimes(4);
    } finally {
      vi.doUnmock("react");
      vi.resetModules();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("keeps image serialization pending through capped transient upload retries", async () => {
    vi.resetModules();
    const uploadFile = vi
      .fn()
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValue({ assetId: "d0f238c8-1c14-4f6c-a695-70d087bb8db0", mimeType: "image/png", created: 1 });
    vi.doMock("react", () => ({
      useCallback: (callback: unknown) => callback,
      useEffect: () => undefined,
      useRef: (current: unknown) => ({ current }),
      useState: (initial: unknown) => [typeof initial === "function" ? (initial as () => unknown)() : initial, vi.fn()],
    }));
    vi.doMock("@excalidraw/excalidraw", () => ({
      CaptureUpdateAction: { NEVER: "never" },
      getSyncableElements: (elements: unknown[]) => elements,
      reconcileElements: (elements: unknown[]) => elements,
      restoreElements: (elements: unknown[]) => elements,
    }));
    vi.doMock("@/services/file.service", () => ({ FileService: vi.fn() }));
    vi.doMock("@/services/work-map.service", () => ({ WorkMapService: vi.fn() }));
    vi.doMock("./assets", () => ({
      addWorkMapAssetMetadata: (files: unknown) => files,
      materializeFiles: vi.fn().mockResolvedValue({}),
      uploadFile,
    }));
    vi.doMock("./scene", () => ({
      addWorkMapAssetMetadata: (file: unknown) => file,
      decodeScene: vi.fn(),
      encodeScene: () => "encoded-scene",
      getNodeKey: vi.fn(),
      getWorkMapFileMetadata: vi.fn(),
      isTransientPersistenceFailure: (error: unknown) => {
        const response = error && typeof error === "object" && "response" in error ? error.response : undefined;
        return Boolean(response && typeof response === "object" && "status" in response && response.status === 503);
      },
    }));
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout, requestAnimationFrame: vi.fn() });

    try {
      const { useScene } = await import("./use-scene");
      const scene = useScene(null, { workspaceSlug: "workspace", projectId: "project", workMapId: "map" });
      const file = {
        id: "image",
        mimeType: "image/png",
        created: 1,
        dataURL: "data:image/png;base64,AA==",
      };
      const serialization = scene.serializeScene([{ id: "image-element", type: "image", fileId: "image" } as never], {
        image: file,
      } as never);
      await vi.advanceTimersByTimeAsync(250);
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(serialization).resolves.toBe("encoded-scene");
      expect(uploadFile).toHaveBeenCalledTimes(5);
    } finally {
      vi.doUnmock("react");
      vi.doUnmock("@excalidraw/excalidraw");
      vi.doUnmock("@/services/file.service");
      vi.doUnmock("@/services/work-map.service");
      vi.doUnmock("./assets");
      vi.doUnmock("./scene");
      vi.resetModules();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("applies scenes before image recovery and rejects stale materialization", async () => {
    vi.resetModules();
    const effects: Array<() => void | (() => void)> = [];
    const setInitialData = vi.fn();
    let stateIndex = 0;
    const initialAssetId = "d0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const remoteAssetId = "e0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const staleAssetId = "f0f238c8-1c14-4f6c-a695-70d087bb8db0";
    const unmountedAssetId = "a0f238c8-1c14-4f6c-a695-70d087bb8db0";
    // oxlint-disable-next-line eslint-plugin-unicorn/consistent-function-scoping -- test data stays local to this lifecycle.
    const metadata = (assetId: string, created: number) => ({ assetId, mimeType: "image/png" as const, created });
    // oxlint-disable-next-line eslint-plugin-unicorn/consistent-function-scoping -- test data stays local to this lifecycle.
    const runtimeFile = (fileId: string, created: number) => ({
      id: fileId,
      mimeType: "image/png" as const,
      created,
      dataURL: "data:image/png;base64,AA==" as const,
    });
    let resolveInitial: ((value: unknown) => void) | undefined;
    let resolveStale: ((value: unknown) => void) | undefined;
    let resolveUnmounted: ((value: unknown) => void) | undefined;
    let remoteAttempts = 0;
    const materializeFilesMock = vi.fn((_service, _workspaceSlug, _projectId, _workMapId, files) => {
      const fileId = Object.keys(files as object)[0];
      if (fileId === "initial") return new Promise((resolve) => (resolveInitial = resolve));
      if (fileId === "remote") {
        remoteAttempts += 1;
        return Promise.resolve(
          remoteAttempts === 1
            ? { files: {}, failures: [{ fileId, error: { code: "ERR_NETWORK" } }] }
            : { files: { remote: runtimeFile("remote", 2) }, failures: [] }
        );
      }
      if (fileId === "stale") return new Promise((resolve) => (resolveStale = resolve));
      if (fileId === "unmounted") return new Promise((resolve) => (resolveUnmounted = resolve));
      return Promise.resolve({ files: {}, failures: [] });
    });
    const initialElements = [{ id: "initial-image", type: "image", fileId: "initial" }] as never;
    const fetchScene = vi.fn().mockResolvedValue({
      collaboration_epoch: 0,
      generation: 0,
      scene_binary: encodeScene({ elements: initialElements, files: { initial: metadata(initialAssetId, 1) } }),
    });
    vi.doMock("react", () => ({
      useCallback: (callback: unknown) => callback,
      useEffect: (effect: () => void | (() => void)) => effects.push(effect),
      useRef: (current: unknown) => ({ current }),
      useState: (initial: unknown) => {
        const setter = stateIndex++ === 0 ? setInitialData : vi.fn();
        return [typeof initial === "function" ? (initial as () => unknown)() : initial, setter];
      },
    }));
    vi.doMock("@excalidraw/excalidraw", () => ({
      CaptureUpdateAction: { NEVER: "never" },
      getSyncableElements: (elements: unknown[]) => elements,
      reconcileElements: (_local: unknown[], remote: unknown[]) => remote,
      restoreElements: (elements: unknown[]) => elements,
    }));
    vi.doMock("@/services/file.service", () => ({ FileService: vi.fn() }));
    vi.doMock("@/services/work-map.service", () => ({
      WorkMapService: class {
        fetchScene = fetchScene;
      },
    }));
    vi.doMock("./assets", () => ({ materializeFiles: materializeFilesMock, uploadFile: vi.fn() }));
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout, requestAnimationFrame: vi.fn() });
    const currentFiles: Record<string, unknown> = {};
    const addFiles = vi.fn((files: Array<{ id: string }>) => files.forEach((file) => (currentFiles[file.id] = file)));
    const updateScene = vi.fn();
    const api = {
      addFiles,
      getAppState: () => ({}),
      getFiles: () => currentFiles,
      getSceneElementsIncludingDeleted: () => [],
      updateScene,
    } as never;

    try {
      const { useScene } = await import("./use-scene");
      const scene = useScene(api, { workspaceSlug: "workspace", projectId: "project", workMapId: "map" });
      const unmount = effects[0]?.();
      effects[1]?.();
      await Promise.resolve();
      await Promise.resolve();
      expect(setInitialData).toHaveBeenCalledWith({
        elements: [expect.objectContaining({ id: "initial-image", type: "image", fileId: "initial" })],
        files: {},
      });
      const serializedInitial = await scene.serializeScene(initialElements, {});
      expect(decodeScene(serializedInitial).files.initial).toEqual(metadata(initialAssetId, 1));

      const remoteElements = [{ id: "remote-image", type: "image", fileId: "remote" }] as never;
      await scene.applyRemoteScene(
        encodeScene({ elements: remoteElements, files: { remote: metadata(remoteAssetId, 2) } })
      );
      expect(updateScene).toHaveBeenCalledWith(
        expect.objectContaining({
          elements: [expect.objectContaining({ id: "remote-image", type: "image", fileId: "remote" })],
        })
      );
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(250);
      expect(addFiles).toHaveBeenCalledWith([expect.objectContaining({ id: "remote", assetId: remoteAssetId })]);

      const staleElements = [{ id: "stale-image", type: "image", fileId: "stale" }] as never;
      await scene.applyRemoteScene(
        encodeScene({ elements: staleElements, files: { stale: metadata(staleAssetId, 3) } })
      );
      await scene.applyAuthoritativeScene({
        collaboration_epoch: 1,
        generation: 1,
        scene_binary: encodeScene({ elements: [], files: {} }),
      });
      resolveStale?.({ files: { stale: runtimeFile("stale", 3) }, failures: [] });
      await Promise.resolve();
      expect(currentFiles).not.toHaveProperty("stale");

      const unmountedElements = [{ id: "unmounted-image", type: "image", fileId: "unmounted" }] as never;
      await scene.applyRemoteScene(
        encodeScene({ elements: unmountedElements, files: { unmounted: metadata(unmountedAssetId, 4) } }),
        1
      );
      if (typeof unmount === "function") unmount();
      resolveUnmounted?.({ files: { unmounted: runtimeFile("unmounted", 4) }, failures: [] });
      resolveInitial?.({ files: { initial: runtimeFile("initial", 1) }, failures: [] });
      await Promise.resolve();
      expect(currentFiles).not.toHaveProperty("unmounted");
      expect(currentFiles).not.toHaveProperty("initial");
    } finally {
      vi.doUnmock("react");
      vi.doUnmock("@excalidraw/excalidraw");
      vi.doUnmock("@/services/file.service");
      vi.doUnmock("@/services/work-map.service");
      vi.doUnmock("./assets");
      vi.resetModules();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
