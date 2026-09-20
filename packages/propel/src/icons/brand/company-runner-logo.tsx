/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as React from "react";

import { SITE_NAME } from "@plane/constants";

import type { ISvgIcons } from "../type";

const MIDDLE_BEAM_PATH = "M40 12H46L72 64H20Z";
const BEAM_COLORS = { left: "#D6A43B", right: "#E3C17A", middle: "#F2E3C3", glow: "#FFF5D8" } as const;

export function CompanyRunnerLogo({
  width = "48",
  height = "32",
  className,
  color,
  gradient = false,
  role,
  middleOpacity,
  middleGlowOpacity,
  "aria-label": ariaLabel,
  ...svgProps
}: ISvgIcons & { gradient?: boolean; middleGlowOpacity?: number; middleOpacity?: number }) {
  const branded = color === undefined;
  const gradientId = React.useId();
  const useGradient = branded && gradient;

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 96 64"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={role ?? "img"}
      aria-label={ariaLabel ?? SITE_NAME}
      {...svgProps}
    >
      {useGradient ? (
        <defs>
          <linearGradient id={`${gradientId}-left`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={BEAM_COLORS.middle} />
            <stop offset="45%" stopColor={BEAM_COLORS.left} />
            <stop offset="100%" stopColor="#A96C1B" />
          </linearGradient>
          <linearGradient id={`${gradientId}-right`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={BEAM_COLORS.glow} />
            <stop offset="50%" stopColor={BEAM_COLORS.right} />
            <stop offset="100%" stopColor="#B78129" />
          </linearGradient>
          <linearGradient id={`${gradientId}-middle`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={BEAM_COLORS.glow} />
            <stop offset="40%" stopColor={BEAM_COLORS.middle} />
            <stop offset="100%" stopColor={BEAM_COLORS.left} />
          </linearGradient>
        </defs>
      ) : null}
      <path
        d="M24 0H40L46 12H40L20 64H0Z"
        fill={useGradient ? `url(#${gradientId}-left)` : branded ? BEAM_COLORS.left : color}
        opacity={branded ? undefined : 1}
      />
      <path
        d="M46 12H54L96 64H72Z"
        fill={useGradient ? `url(#${gradientId}-right)` : branded ? BEAM_COLORS.right : color}
        opacity={branded ? undefined : 0.64}
      />
      {branded && middleGlowOpacity !== undefined ? (
        <path d={MIDDLE_BEAM_PATH} fill={BEAM_COLORS.glow} opacity={middleGlowOpacity} />
      ) : null}
      <path
        d={MIDDLE_BEAM_PATH}
        fill={useGradient ? `url(#${gradientId}-middle)` : branded ? BEAM_COLORS.middle : color}
        opacity={branded ? middleOpacity : 0.22}
      />
    </svg>
  );
}
