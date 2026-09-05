/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as React from "react";

import { IconWrapper } from "./icon-wrapper";
import type { ISvgIcons } from "./type";

export function WorkMapIcon({ color = "currentColor", ...rest }: ISvgIcons) {
  return (
    <IconWrapper color={color} {...rest}>
      <path
        d="M9.404 3.702a1.333 1.333 0 0 0 1.192 0l2.439-1.22A.667.667 0 0 1 14 3.079v8.509a.667.667 0 0 1-.369.596l-3.035 1.518a1.333 1.333 0 0 1-1.192 0l-2.808-1.404a1.333 1.333 0 0 0-1.192 0l-2.439 1.22A.667.667 0 0 1 2 12.921V4.412a.667.667 0 0 1 .369-.596l3.035-1.518a1.333 1.333 0 0 1 1.192 0Z"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
      <path d="M10 3.843v10M6 2.157v10" stroke={color} strokeLinecap="round" strokeWidth="1.25" />
    </IconWrapper>
  );
}
