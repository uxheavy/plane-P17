/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import packageJson from "../../../../package.json";
import { AuthFooter } from "../../../../core/components/auth-screens/footer";

vi.mock("@plane/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "version" ? "Version" : key),
  }),
}));

describe("AuthFooter", () => {
  it("shows the running Plane version", () => {
    const footer = renderToStaticMarkup(createElement(AuthFooter));

    expect(footer).toContain(`Version: v${packageJson.version}`);
  });
});
