/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { ListSearchInput } from "@/components/core/list";

type Props = {
  searchQuery: string;
  updateSearchQuery: (value: string) => void;
};

export function PageSearchInput(props: Props) {
  return <ListSearchInput {...props} placeholder="Search pages" />;
}
