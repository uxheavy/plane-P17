/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import packageJson from "../../../../package.json";
import { AuthFooter } from "../../../../core/components/auth-screens/footer";

describe("AuthFooter", () => {
  it("shows the running Plane build", () => {
    const footer = renderToStaticMarkup(createElement(AuthFooter));

    expect(footer).toContain(`v${packageJson.version} (abc12) TEST`);
  });
});
