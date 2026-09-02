/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { FAVORITE_ITEM_LINKS } from "@plane/constants";
import type { IFavorite } from "@plane/types";

export const generateFavoriteItemLink = (workspaceSlug: string, favorite: IFavorite) => {
  const entityLinkDetails = FAVORITE_ITEM_LINKS[favorite.entity_type];

  if (!entityLinkDetails) {
    console.error(`Unrecognized favorite entity type: ${favorite.entity_type}`);
    return `/${workspaceSlug}`;
  }

  if (entityLinkDetails.itemLevel === "workspace") {
    return `/${workspaceSlug}/${entityLinkDetails.getLink(favorite)}`;
  } else if (entityLinkDetails.itemLevel === "project") {
    const projectId = favorite.project_id ?? favorite.entity_data?.project_id;
    return projectId
      ? `/${workspaceSlug}/projects/${projectId}/${entityLinkDetails.getLink(favorite)}`
      : `/${workspaceSlug}`;
  } else {
    return `/${workspaceSlug}`;
  }
};
