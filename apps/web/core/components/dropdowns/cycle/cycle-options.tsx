/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import type { Placement } from "@popperjs/core";
import { observer } from "mobx-react";
import { usePopper } from "react-popper";
// components
import { Combobox } from "@headlessui/react";
// i18n
import { useTranslation } from "@plane/i18n";
// icon
import { CheckIcon, CycleGroupIcon, CycleIcon, SearchIcon } from "@plane/propel/icons";
import type { TCycleGroups } from "@plane/types";
// ui
// store hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { usePlatformOS } from "@/hooks/use-platform-os";
// types

type CycleOptionsProps = {
  referenceElement: HTMLButtonElement | null;
  placement: Placement | undefined;
  isOpen: boolean;
  options: (string | null)[];
  query: string;
  setQuery: (query: string) => void;
};

export const CycleOptions = observer(function CycleOptions(props: CycleOptionsProps) {
  const { isOpen, options, query, referenceElement, placement, setQuery } = props;
  // i18n
  const { t } = useTranslation();
  //state hooks
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // store hooks
  const { getCycleById } = useCycle();
  const { isMobile } = usePlatformOS();
  useEffect(() => {
    if (isOpen) {
      if (!isMobile) {
        inputRef.current?.focus();
      }
    }
  }, [isMobile, isOpen]);

  // popper-js init
  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: placement ?? "bottom-start",
    strategy: "fixed",
    modifiers: [
      {
        name: "preventOverflow",
        options: {
          padding: 12,
        },
      },
    ],
  });

  const searchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (query !== "" && e.key === "Escape") {
      e.stopPropagation();
      setQuery("");
    }
  };

  return (
    <div
      className="fixed z-10 my-1 w-48 rounded-sm border-[0.5px] border-strong bg-surface-1 px-2 py-2.5 text-11 shadow-raised-200 focus:outline-none"
      ref={setPopperElement}
      style={styles.popper}
      {...attributes.popper}
    >
      <div className="flex items-center gap-1.5 rounded-sm border border-subtle bg-surface-2 px-2">
        <SearchIcon className="h-3.5 w-3.5 text-placeholder" strokeWidth={1.5} />
        <Combobox.Input
          as="input"
          ref={inputRef}
          className="w-full bg-transparent py-1 text-11 text-secondary placeholder:text-placeholder focus:outline-none"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("common.search.label")}
          displayValue={(assigned: any) => assigned?.name}
          onKeyDown={searchInputKeyDown}
        />
      </div>
      {options.length > 0 ? (
        <Combobox.Options as="ul" className="mt-2 h-48 space-y-1 overflow-y-scroll" modal={false} static>
          {({ option }: { option: string | null }) => {
            const cycleDetails = option ? getCycleById(option) : null;
            const cycleStatus = cycleDetails?.status
              ? (cycleDetails.status.toLocaleLowerCase() as TCycleGroups)
              : "draft";
            return (
              <Combobox.Option
                as="li"
                key={option ?? "no-cycle"}
                value={option}
                className={({ active, selected }) =>
                  `flex w-full cursor-pointer items-center justify-between gap-2 truncate rounded-sm px-1 py-1.5 select-none ${
                    active ? "bg-layer-transparent-hover" : ""
                  } ${selected ? "text-primary" : "text-secondary"}`
                }
              >
                {({ selected }) => (
                  <>
                    <span className="flex flex-grow items-center gap-2 truncate">
                      {option ? (
                        <CycleGroupIcon cycleGroup={cycleStatus} className="h-3.5 w-3.5 flex-shrink-0" />
                      ) : (
                        <CycleIcon className="h-3 w-3 flex-shrink-0" />
                      )}
                      <span className="flex-grow truncate">{cycleDetails?.name ?? t("cycle.no_cycle")}</span>
                    </span>
                    {selected && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0" />}
                  </>
                )}
              </Combobox.Option>
            );
          }}
        </Combobox.Options>
      ) : (
        <p className="mt-2 px-1.5 py-1 text-placeholder italic">{t("common.search.no_matches_found")}</p>
      )}
    </div>
  );
});
