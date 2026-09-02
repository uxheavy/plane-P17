/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { usePopper } from "react-popper";
// plane imports
import { useTranslation } from "@plane/i18n";
import { StateGroupIcon } from "@plane/propel/icons";
import type { IState } from "@plane/types";
import { ComboDropDown } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import type { TDropdownProps } from "@/components/dropdowns/types";
// hooks
import { useDropdown } from "@/hooks/use-dropdown";
// plane web imports
import { StateOption } from "@/components/workflow";
import { StateDropdownButton, StateDropdownOptions } from "../state/state-dropdown-options";

export type TWorkItemStateDropdownBaseProps = TDropdownProps & {
  alwaysAllowStateChange?: boolean;
  button?: ReactNode;
  dropdownArrow?: boolean;
  dropdownArrowClassName?: string;
  filterAvailableStateIds?: boolean;
  getStateById: (stateId: string | null | undefined) => IState | undefined;
  iconSize?: string;
  isForWorkItemCreation?: boolean;
  isInitializing?: boolean;
  onChange: (val: string) => void;
  onClose?: () => void;
  onDropdownOpen?: () => void;
  projectId: string | undefined;
  renderByDefault?: boolean;
  showDefaultState?: boolean;
  stateIds: string[];
  value: string | undefined | null;
};

export const WorkItemStateDropdownBase = observer(function WorkItemStateDropdownBase(
  props: TWorkItemStateDropdownBaseProps
) {
  const {
    button,
    buttonClassName,
    buttonContainerClassName,
    buttonVariant,
    className = "",
    disabled = false,
    dropdownArrow = false,
    dropdownArrowClassName = "",
    getStateById,
    hideIcon = false,
    iconSize = "size-4",
    isInitializing = false,
    onChange,
    onClose,
    onDropdownOpen,
    placement,
    renderByDefault = true,
    showDefaultState = true,
    showTooltip = false,
    stateIds,
    tabIndex,
    value,
  } = props;
  // refs
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // popper-js refs
  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  // states
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  // store hooks
  const { t } = useTranslation();
  const statesList = stateIds.map((stateId) => getStateById(stateId)).filter((state) => !!state);
  const defaultState = statesList?.find((state) => state?.default);
  const stateValue = value ? value : showDefaultState ? defaultState?.id : undefined;
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
  // dropdown init
  const { handleClose, handleKeyDown, handleOnClick, searchInputKeyDown } = useDropdown({
    dropdownRef,
    inputRef,
    isOpen,
    onClose,
    onOpen: onDropdownOpen,
    query,
    setIsOpen,
    setQuery,
  });

  // derived values
  const options = statesList?.map((state) => ({
    value: state?.id,
    query: `${state?.name}`,
    content: (
      <div className="flex items-center gap-2">
        <StateGroupIcon
          stateGroup={state?.group ?? "backlog"}
          color={state?.color}
          className={cn("flex-shrink-0", iconSize)}
          percentage={state?.order}
        />
        <span className="flex-grow truncate text-left">{state?.name}</span>
      </div>
    ),
  }));

  const filteredOptions =
    query === "" ? options : options?.filter((o) => o.query.toLowerCase().includes(query.toLowerCase()));

  const selectedState = stateValue ? getStateById(stateValue) : undefined;

  const dropdownOnChange = (val: string) => {
    onChange(val);
    handleClose();
  };

  const comboButton = (
    <StateDropdownButton
      button={button}
      buttonClassName={buttonClassName}
      buttonContainerClassName={buttonContainerClassName}
      buttonVariant={buttonVariant}
      disabled={disabled}
      dropdownArrow={dropdownArrow}
      dropdownArrowClassName={dropdownArrowClassName}
      hideIcon={hideIcon}
      icon={
        <StateGroupIcon
          stateGroup={selectedState?.group ?? "backlog"}
          color={selectedState?.color ?? "var(--text-color-tertiary)"}
          className={cn("flex-shrink-0", iconSize)}
          percentage={selectedState?.order}
        />
      }
      isInitializing={isInitializing}
      isOpen={isOpen}
      onClick={handleOnClick}
      referenceElement={setReferenceElement}
      renderByDefault={renderByDefault}
      selectedName={selectedState?.name}
      showTooltip={showTooltip}
      stateLabel={t("state")}
      tabIndex={tabIndex}
    />
  );

  return (
    // oxlint-disable-next-line jsx_a11y/no-static-element-interactions
    <ComboDropDown
      as="div"
      ref={dropdownRef}
      className={cn("h-full", className)}
      value={stateValue}
      onChange={dropdownOnChange}
      disabled={disabled}
      onKeyDown={handleKeyDown}
      button={comboButton}
      renderByDefault={renderByDefault}
    >
      {isOpen && (
        <StateDropdownOptions
          attributes={attributes.popper}
          inputRef={inputRef}
          modal={false}
          noMatchingResults={<p className="px-1.5 py-1 text-placeholder italic">{t("loading")}</p>}
          options={
            filteredOptions ? (
              filteredOptions.length > 0 ? (
                filteredOptions.map((option) => (
                  <StateOption
                    {...props}
                    key={option.value}
                    option={option}
                    selectedValue={value}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 truncate rounded-sm px-1 py-1.5 select-none"
                  />
                ))
              ) : (
                <p className="px-1.5 py-1 text-placeholder italic">{t("no_matching_results")}</p>
              )
            ) : undefined
          }
          placeholder={t("common.search.label")}
          popperElementRef={setPopperElement}
          query={query}
          searchInputKeyDown={searchInputKeyDown}
          setQuery={setQuery}
          style={styles.popper}
        />
      )}
    </ComboDropDown>
  );
});
