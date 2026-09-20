/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as React from "react";

import { SITE_NAME } from "@plane/constants";

import type { ISvgIcons } from "../type";

export const COMPANY_RUNNER_WORDMARK_TYPOGRAPHY = {
  baseline: 28.7273,
  fontFile: "apps/web/app/assets/fonts/inter/bold.ttf",
  fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif",
  fontSize: 24,
  fontWeight: 700,
  letterSpacing: -0.5,
  x: 2,
} as const;

export function CompanyRunnerWordmark({
  width = "224",
  height = "40",
  className,
  color = "currentColor",
  role,
  "aria-label": ariaLabel,
  ...svgProps
}: ISvgIcons) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 224 40"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={role ?? "img"}
      aria-label={ariaLabel ?? SITE_NAME}
      {...svgProps}
    >
      <text
        x={COMPANY_RUNNER_WORDMARK_TYPOGRAPHY.x}
        y={COMPANY_RUNNER_WORDMARK_TYPOGRAPHY.baseline}
        fill={color}
        fontFamily={COMPANY_RUNNER_WORDMARK_TYPOGRAPHY.fontFamily}
        fontSize={COMPANY_RUNNER_WORDMARK_TYPOGRAPHY.fontSize}
        fontWeight={COMPANY_RUNNER_WORDMARK_TYPOGRAPHY.fontWeight}
        letterSpacing={`${COMPANY_RUNNER_WORDMARK_TYPOGRAPHY.letterSpacing}px`}
      >
        {SITE_NAME}
      </text>
    </svg>
  );
}
