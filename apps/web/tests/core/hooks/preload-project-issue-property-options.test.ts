/**
 * Copyright (c) 2026 Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";

import { preloadMissingProjectIssuePropertyOptions } from "../../../core/hooks/preload-project-issue-property-options";

const optionNames = ["states", "members", "labels", "cycles", "modules", "estimates"];

const preloadsFor = (loaded: Set<string>, calls: string[], wait: Promise<unknown> = Promise.resolve()) =>
  optionNames.map((option) => ({
    isLoaded: loaded.has(option),
    load: async () => {
      calls.push(option);
      await wait;
    },
  }));

describe("preloadMissingProjectIssuePropertyOptions", () => {
  it("preloads only missing project issue property options", async () => {
    await Promise.all(
      [
        [[], optionNames],
        [optionNames, []],
        [
          ["states", "labels", "modules"],
          ["members", "cycles", "estimates"],
        ],
      ].map(async ([loaded, expected]) => {
        const calls: string[] = [];
        await preloadMissingProjectIssuePropertyOptions(preloadsFor(new Set(loaded), calls));
        expect(calls).toEqual(expected);
      })
    );
  });

  it("starts missing option requests together", async () => {
    const calls: string[] = [];
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const preload = preloadMissingProjectIssuePropertyOptions(
      preloadsFor(new Set(["states", "labels", "modules"]), calls, wait)
    );

    expect(calls).toEqual(["members", "cycles", "estimates"]);
    release?.();
    await preload;
  });

  it("skips disabled options and contains speculative preload failures", async () => {
    const calls: string[] = [];

    await expect(
      preloadMissingProjectIssuePropertyOptions([
        { isEnabled: false, isLoaded: false, load: async () => calls.push("disabled") },
        {
          isLoaded: false,
          load: async () => {
            calls.push("failed");
            throw new Error("unavailable");
          },
        },
        { isLoaded: false, load: async () => calls.push("available") },
      ])
    ).resolves.toBeUndefined();

    expect(calls).toEqual(["failed", "available"]);
  });
});
