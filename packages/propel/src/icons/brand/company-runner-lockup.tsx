/**
 * Copyright (c) 2023-present Ngo Quoc Huy and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import { SITE_NAME } from "@plane/constants";

import type { ISvgIcons } from "../type";

import { CompanyRunnerLogo } from "./company-runner-logo";
import { CompanyRunnerWordmark } from "./company-runner-wordmark";

export function CompanyRunnerLockup({
  width = "284",
  height = "40",
  className,
  color,
  wordmarkColor,
  role,
  "aria-label": ariaLabel,
  ...svgProps
}: ISvgIcons & { wordmarkColor?: string }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 284 40"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={role ?? "img"}
      aria-label={ariaLabel ?? SITE_NAME}
      {...svgProps}
    >
      <CompanyRunnerLogo width="48" height="32" x="0" y="4" color={color} aria-hidden="true" />
      <CompanyRunnerWordmark
        width="224"
        height="40"
        x="60"
        y="0"
        color={wordmarkColor ?? color ?? "currentColor"}
        aria-hidden="true"
      />
    </svg>
  );
}
