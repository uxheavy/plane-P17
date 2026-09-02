/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { Combobox } from "@headlessui/react";
import { ChevronDownIcon, SearchIcon } from "@plane/propel/icons";
import { Spinner } from "@plane/ui";
import { cn } from "@plane/utils";
import { DropdownButton } from "@/components/dropdowns/buttons";
import { BUTTON_VARIANTS_WITH_TEXT } from "@/components/dropdowns/constants";
import type { TDropdownProps } from "@/components/dropdowns/types";

type StateDropdownButtonProps = {
  button?: ReactNode;
  buttonClassName?: string;
  buttonContainerClassName?: string;
  buttonVariant: TDropdownProps["buttonVariant"];
  disabled: boolean;
  dropdownArrow: boolean;
  dropdownArrowClassName?: string;
  hideIcon: boolean;
  icon: ReactNode;
  isInitializing: boolean;
  isOpen: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  referenceElement: (element: HTMLButtonElement | null) => void;
  renderByDefault: boolean;
  selectedName?: string;
  showTooltip: boolean;
  stateLabel: string;
  tabIndex?: number;
};

export function StateDropdownButton(props: StateDropdownButtonProps) {
  const {
    button,
    buttonClassName,
    buttonContainerClassName,
    buttonVariant,
    disabled,
    dropdownArrow,
    dropdownArrowClassName,
    hideIcon,
    icon,
    isInitializing,
    isOpen,
    onClick,
    referenceElement,
    renderByDefault,
    selectedName,
    showTooltip,
    stateLabel,
    tabIndex,
  } = props;

  if (button) {
    return (
      <button
        ref={referenceElement}
        type="button"
        className={cn("clickable block h-full w-full outline-none", buttonContainerClassName)}
        onClick={onClick}
        disabled={disabled}
        tabIndex={tabIndex}
      >
        {button}
      </button>
    );
  }

  return (
    <button
      tabIndex={tabIndex}
      ref={referenceElement}
      type="button"
      className={cn(
        "clickable block h-full max-w-full outline-none",
        {
          "cursor-not-allowed text-secondary": disabled,
          "cursor-pointer": !disabled,
        },
        buttonContainerClassName
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <DropdownButton
        className={buttonClassName}
        isActive={isOpen}
        tooltipHeading={stateLabel}
        tooltipContent={selectedName ?? stateLabel}
        showTooltip={showTooltip}
        variant={buttonVariant}
        renderToolTipByDefault={renderByDefault}
      >
        {isInitializing ? (
          <Spinner className="h-3.5 w-3.5" />
        ) : (
          <>
            {!hideIcon && icon}
            {BUTTON_VARIANTS_WITH_TEXT.includes(buttonVariant) && (
              <span className="flex-grow truncate text-left">{selectedName ?? stateLabel}</span>
            )}
            {dropdownArrow && (
              <ChevronDownIcon className={cn("h-2.5 w-2.5 flex-shrink-0", dropdownArrowClassName)} aria-hidden="true" />
            )}
          </>
        )}
      </DropdownButton>
    </button>
  );
}

type StateDropdownOptionsProps = {
  attributes: Record<string, string> | undefined;
  inputRef: React.RefObject<HTMLInputElement | null>;
  modal?: boolean;
  noMatchingResults: ReactNode;
  options: ReactNode;
  placeholder: string;
  popperElementRef: (element: HTMLDivElement | null) => void;
  query: string;
  searchInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  setQuery: (query: string) => void;
  style: React.CSSProperties;
};

export function StateDropdownOptions(props: StateDropdownOptionsProps) {
  const {
    attributes,
    inputRef,
    modal,
    noMatchingResults,
    options,
    placeholder,
    popperElementRef,
    query,
    searchInputKeyDown,
    setQuery,
    style,
  } = props;

  return (
    <Combobox.Options as="ul" className="fixed z-10" modal={modal} static>
      <div
        className="my-1 w-48 rounded-sm border-[0.5px] border-strong bg-surface-1 px-2 py-2.5 text-11 shadow-raised-200 focus:outline-none"
        ref={popperElementRef}
        style={style}
        {...(attributes ?? {})}
      >
        <div className="flex items-center gap-1.5 rounded-sm border border-subtle bg-surface-2 px-2">
          <SearchIcon className="h-3.5 w-3.5 text-placeholder" strokeWidth={1.5} />
          <Combobox.Input
            as="input"
            ref={inputRef}
            className="w-full bg-transparent py-1 text-11 text-secondary placeholder:text-placeholder focus:outline-none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            onKeyDown={searchInputKeyDown}
          />
        </div>
        <div className="mt-2 max-h-48 space-y-1 overflow-y-scroll">{options ?? noMatchingResults}</div>
      </div>
    </Combobox.Options>
  );
}
