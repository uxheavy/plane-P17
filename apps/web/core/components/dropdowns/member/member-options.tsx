/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import type { Placement } from "@popperjs/core";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { createPortal } from "react-dom";
import { usePopper } from "react-popper";
import { Combobox } from "@headlessui/react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { CheckIcon, SearchIcon, SuspendedUserIcon } from "@plane/propel/icons";
import { EPillSize, EPillVariant, Pill } from "@plane/propel/pill";
import type { IUserLite } from "@plane/types";
import { Avatar } from "@plane/ui";
import { cn, getFileURL } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useUser } from "@/hooks/store/user";
import { usePlatformOS } from "@/hooks/use-platform-os";

interface Props {
  className?: string;
  getUserDetails: (userId: string) => IUserLite | undefined;
  isOpen: boolean;
  onDropdownOpen?: () => void;
  options: string[];
  optionsClassName?: string;
  placement: Placement | undefined;
  referenceElement: HTMLButtonElement | null;
  query: string;
  setQuery: (query: string) => void;
}

export const MemberOptions = observer(function MemberOptions(props: Props) {
  const {
    getUserDetails,
    isOpen,
    onDropdownOpen,
    options,
    optionsClassName = "",
    placement,
    referenceElement,
    query,
    setQuery,
  } = props;
  // router
  const { workspaceSlug } = useParams();
  // refs
  const inputRef = useRef<HTMLInputElement | null>(null);
  // states
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { data: currentUser } = useUser();
  const {
    workspace: { isUserSuspended },
  } = useMember();
  const { isMobile } = usePlatformOS();
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

  useEffect(() => {
    if (isOpen) {
      onDropdownOpen?.();
      if (!isMobile) {
        inputRef.current?.focus();
      }
    }
  }, [isOpen, isMobile, onDropdownOpen]);

  const searchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (query !== "" && e.key === "Escape") {
      e.stopPropagation();
      setQuery("");
    }
  };

  return createPortal(
    <div
      className={cn(
        "z-30 my-1 w-48 rounded-sm border-[0.5px] border-strong bg-surface-1 px-2 py-2.5 text-11 shadow-raised-200 focus:outline-none",
        optionsClassName
      )}
      ref={setPopperElement}
      style={{
        ...styles.popper,
      }}
      {...attributes.popper}
      data-prevent-outside-click
    >
      <div className="flex items-center gap-1.5 rounded-sm border border-subtle bg-surface-2 px-2">
        <SearchIcon className="h-3.5 w-3.5 text-placeholder" strokeWidth={1.5} />
        <Combobox.Input
          as="input"
          ref={inputRef}
          className="w-full bg-transparent py-1 text-11 text-secondary placeholder:text-placeholder focus:outline-none"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          displayValue={(assigned: any) => assigned?.name}
          onKeyDown={searchInputKeyDown}
        />
      </div>
      {options.length > 0 ? (
        <Combobox.Options
          as="ul"
          className="mt-2 h-48 space-y-1 overflow-y-scroll"
          data-prevent-outside-click
          modal={false}
          static
        >
          {({ option }: { option: string }) => {
            const userDetails = getUserDetails(option);
            const suspended = isUserSuspended(option, workspaceSlug?.toString());
            return (
              <Combobox.Option
                as="li"
                key={option}
                value={option}
                className={({ active, selected }) =>
                  cn(
                    "flex w-full items-center justify-between gap-2 truncate rounded-sm px-1 py-1.5 select-none",
                    active && "bg-layer-transparent-hover",
                    selected ? "text-primary" : "text-secondary",
                    suspended ? "cursor-not-allowed" : "cursor-pointer"
                  )
                }
                disabled={suspended}
              >
                {({ selected }) => (
                  <>
                    <span className="flex flex-grow items-center gap-2 truncate">
                      <span className="w-4">
                        {suspended ? (
                          <SuspendedUserIcon className="h-3.5 w-3.5 text-placeholder" />
                        ) : (
                          <Avatar name={userDetails?.display_name} src={getFileURL(userDetails?.avatar_url ?? "")} />
                        )}
                      </span>
                      <span className={cn("flex-grow truncate", suspended && "text-placeholder")}>
                        {currentUser?.id === option ? t("you") : userDetails?.display_name}
                      </span>
                    </span>
                    {selected && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0" />}
                    {suspended && (
                      <Pill variant={EPillVariant.DEFAULT} size={EPillSize.XS} className="border-none">
                        Suspended
                      </Pill>
                    )}
                  </>
                )}
              </Combobox.Option>
            );
          }}
        </Combobox.Options>
      ) : (
        <p className="mt-2 px-1.5 py-1 text-placeholder italic">{t("no_matching_results")}</p>
      )}
    </div>,
    document.body
  );
});
