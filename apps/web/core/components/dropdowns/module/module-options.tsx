/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import type { Placement } from "@popperjs/core";
import { observer } from "mobx-react";
import { usePopper } from "react-popper";
import { Combobox } from "@headlessui/react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { CheckIcon, SearchIcon, ModuleIcon } from "@plane/propel/icons";
import type { IModule } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { usePlatformOS } from "@/hooks/use-platform-os";

interface Props {
  getModuleById: (moduleId: string) => IModule | null;
  isOpen: boolean;
  onDropdownOpen?: () => void;
  options: (string | null)[];
  placement: Placement | undefined;
  query: string;
  referenceElement: HTMLButtonElement | null;
  setQuery: (query: string) => void;
}

export const ModuleOptions = observer(function ModuleOptions(props: Props) {
  const { getModuleById, isOpen, onDropdownOpen, options, placement, query, referenceElement, setQuery } = props;
  // refs
  const inputRef = useRef<HTMLInputElement | null>(null);
  // states
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { isMobile } = usePlatformOS();

  useEffect(() => {
    if (isOpen) {
      onOpen();
      if (!isMobile) {
        inputRef.current?.focus();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isMobile]);

  // popper-js init
  const { styles, attributes } = usePopper(referenceElement, popperElement, {
    placement: placement ?? "bottom-start",
    modifiers: [
      {
        name: "preventOverflow",
        options: {
          padding: 12,
        },
      },
    ],
  });

  const onOpen = () => {
    onDropdownOpen?.();
  };

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
            const moduleDetails = option ? getModuleById(option) : null;
            return (
              <Combobox.Option
                as="li"
                key={option ?? "no-module"}
                value={option}
                className={({ active, selected }) =>
                  cn(
                    "flex w-full cursor-pointer items-center justify-between gap-2 truncate rounded-sm px-1 py-1.5 select-none",
                    {
                      "bg-layer-transparent-hover": active,
                      "text-primary": selected,
                      "text-secondary": !selected,
                    }
                  )
                }
              >
                {({ selected }) => (
                  <>
                    <span className="flex flex-grow items-center gap-2 truncate">
                      <ModuleIcon className="h-3 w-3 flex-shrink-0" />
                      <span className="flex-grow truncate">{moduleDetails?.name ?? t("module.no_module")}</span>
                    </span>
                    {selected && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0" />}
                  </>
                )}
              </Combobox.Option>
            );
          }}
        </Combobox.Options>
      ) : (
        <p className="mt-2 px-1.5 py-1 text-placeholder italic">{t("common.search.no_matching_results")}</p>
      )}
    </div>
  );
});
