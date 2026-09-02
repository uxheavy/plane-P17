/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useWorkMap } from "@/hooks/store/use-work-map";
import { WorkMapSourceCard } from "./source-card";

type Props = {
  nodeKey: string;
  onOpen: () => void;
};

export const WorkMapSourceNode = observer(function WorkMapSourceNode({ nodeKey, onOpen }: Props) {
  const store = useWorkMap();
  const projection = store.projections[nodeKey];

  return (
    <div
      data-testid="work-map-node"
      data-source-kind={projection ? (projection.available ? projection.source.source_kind : "unavailable") : "loading"}
      className="size-full overflow-hidden rounded-lg"
    >
      <WorkMapSourceCard projection={projection} onOpen={onOpen} />
    </div>
  );
});
