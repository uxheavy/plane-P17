/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { usePopper } from "react-popper";
import { Combobox } from "@headlessui/react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { CheckIcon, SearchIcon, EstimatePropertyIcon, ChevronDownIcon } from "@plane/propel/icons";
import type { IEstimatePoint } from "@plane/types";
import { EEstimateSystem } from "@plane/types";
import { ComboDropDown } from "@plane/ui";
import { convertMinutesToHoursMinutesString, cn } from "@plane/utils";
// hooks
import { useProjectEstimates } from "@/hooks/store/estimates";
import { useEstimate } from "@/hooks/store/estimates/use-estimate";
import { useDropdown } from "@/hooks/use-dropdown";
// components
import { DropdownButton } from "./buttons";
import { BUTTON_VARIANTS_WITH_TEXT } from "./constants";
// types
import type { TDropdownProps } from "./types";

type Props = TDropdownProps & {
  button?: ReactNode;
  dropdownArrow?: boolean;
  dropdownArrowClassName?: string;
  onChange: (val: string | undefined) => void;
  onClose?: () => void;
  projectId: string | undefined;
  value: string | undefined | null;
  renderByDefault?: boolean;
};

type DropdownOption = {
  value: string | null;
  query: string;
  content: React.ReactNode;
};

type EstimateDropdownButtonProps = {
  button?: ReactNode;
  buttonClassName?: string;
  buttonContainerClassName?: string;
  buttonVariant: Props["buttonVariant"];
  currentActiveEstimateType?: EEstimateSystem;
  disabled: boolean;
  dropdownArrow: boolean;
  dropdownArrowClassName?: string;
  hideIcon: boolean;
  isOpen: boolean;
  estimateLabel: string;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  placeholder: string;
  referenceElement: (element: HTMLButtonElement | null) => void;
  renderByDefault: boolean;
  selectedEstimate?: IEstimatePoint;
  showTooltip: boolean;
};

function EstimateDropdownButton(props: EstimateDropdownButtonProps) {
  const {
    button,
    buttonClassName,
    buttonContainerClassName,
    buttonVariant,
    currentActiveEstimateType,
    disabled,
    dropdownArrow,
    dropdownArrowClassName,
    estimateLabel,
    hideIcon,
    isOpen,
    onClick,
    onKeyDown,
    placeholder,
    referenceElement,
    renderByDefault,
    selectedEstimate,
    showTooltip,
  } = props;

  if (button) {
    return (
      <button
        ref={referenceElement}
        type="button"
        className={cn("clickable block h-full w-full outline-none", buttonContainerClassName)}
        onClick={onClick}
        onKeyDown={onKeyDown}
        disabled={disabled}
      >
        {button}
      </button>
    );
  }

  return (
    <button
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
      onKeyDown={onKeyDown}
      disabled={disabled}
    >
      <DropdownButton
        className={buttonClassName}
        isActive={isOpen}
        tooltipHeading={estimateLabel}
        tooltipContent={selectedEstimate?.value ?? placeholder}
        showTooltip={showTooltip}
        variant={buttonVariant}
        renderToolTipByDefault={renderByDefault}
      >
        {!hideIcon && <EstimatePropertyIcon className="h-3 w-3 flex-shrink-0" />}
        {(selectedEstimate || placeholder) && BUTTON_VARIANTS_WITH_TEXT.includes(buttonVariant) && (
          <span className="truncate">
            {selectedEstimate ? (
              currentActiveEstimateType === EEstimateSystem.TIME ? (
                convertMinutesToHoursMinutesString(Number(selectedEstimate.value))
              ) : (
                selectedEstimate.value
              )
            ) : (
              <span className="text-placeholder">{placeholder}</span>
            )}
          </span>
        )}
        {dropdownArrow && (
          <ChevronDownIcon className={cn("h-2.5 w-2.5 flex-shrink-0", dropdownArrowClassName)} aria-hidden="true" />
        )}
      </DropdownButton>
    </button>
  );
}

type EstimateDropdownOptionsProps = {
  attributes: Record<string, string> | undefined;
  currentActiveEstimateId?: string;
  filteredOptions: DropdownOption[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  noEstimateLabel: string;
  noMatchingResults: string;
  popperElementRef: (element: HTMLDivElement | null) => void;
  placeholder: string;
  query: string;
  searchInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  setQuery: (query: string) => void;
  style: React.CSSProperties;
};

function EstimateDropdownOptions(props: EstimateDropdownOptionsProps) {
  const {
    attributes,
    currentActiveEstimateId,
    filteredOptions,
    inputRef,
    noEstimateLabel,
    noMatchingResults,
    placeholder,
    popperElementRef,
    query,
    searchInputKeyDown,
    setQuery,
    style,
  } = props;

  return (
    <Combobox.Options as="ul" className="fixed z-10" modal={false} static>
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
        <div className="mt-2 max-h-48 space-y-1 overflow-y-scroll">
          {currentActiveEstimateId === undefined ? (
            <div className="flex w-full items-center justify-between gap-2 truncate rounded-sm px-1 py-1.5 text-secondary select-none">
              <div className="flex flex-grow items-center gap-2">
                <EstimatePropertyIcon className="h-3 w-3 flex-shrink-0" />
                <span className="flex-grow truncate">{noEstimateLabel}</span>
              </div>
            </div>
          ) : filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <Combobox.Option as="li" key={option.value} value={option.value}>
                {({ active, selected }) => (
                  <div
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between gap-2 truncate rounded-sm px-1 py-1.5 select-none",
                      {
                        "bg-layer-transparent-hover": active,
                        "text-primary": selected,
                        "text-secondary": !selected,
                      }
                    )}
                  >
                    <span className="flex-grow truncate">{option.content}</span>
                    {selected && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0" />}
                  </div>
                )}
              </Combobox.Option>
            ))
          ) : (
            <p className="px-1.5 py-1 text-placeholder italic">{noMatchingResults}</p>
          )}
        </div>
      </div>
    </Combobox.Options>
  );
}

export const EstimateDropdown = observer(function EstimateDropdown(props: Props) {
  const {
    button,
    buttonClassName,
    buttonContainerClassName,
    buttonVariant,
    className = "",
    disabled = false,
    dropdownArrow = false,
    dropdownArrowClassName = "",
    hideIcon = false,
    onChange,
    onClose,
    placeholder = "",
    placement,
    projectId,
    showTooltip = false,
    tabIndex,
    value,
    renderByDefault = true,
  } = props;
  // i18n
  const { t } = useTranslation();
  // states
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  // refs
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // popper-js refs
  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
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
  // router
  const { workspaceSlug } = useParams();
  // store hooks
  const { currentActiveEstimateIdByProjectId, getProjectEstimates, getEstimateById } = useProjectEstimates();
  const { estimatePointIds, estimatePointById } = useEstimate(
    projectId ? currentActiveEstimateIdByProjectId(projectId) : undefined
  );

  const currentActiveEstimateId = projectId ? currentActiveEstimateIdByProjectId(projectId) : undefined;

  const currentActiveEstimate = currentActiveEstimateId ? getEstimateById(currentActiveEstimateId) : undefined;

  const options: DropdownOption[] = (estimatePointIds ?? []).flatMap((estimatePoint) => {
    const currentEstimatePoint = estimatePointById(estimatePoint);
    return currentEstimatePoint
      ? [
          {
            value: currentEstimatePoint.id ?? null,
            query: `${currentEstimatePoint.value}`,
            content: (
              <div className="flex items-center gap-2">
                <EstimatePropertyIcon className="h-3 w-3 flex-shrink-0" />
                <span className="flex-grow truncate">
                  {currentActiveEstimate?.type === EEstimateSystem.TIME
                    ? convertMinutesToHoursMinutesString(Number(currentEstimatePoint.value))
                    : currentEstimatePoint.value}
                </span>
              </div>
            ),
          },
        ]
      : [];
  });
  options.unshift({
    value: null,
    query: t("project_settings.estimates.no_estimate"),
    content: (
      <div className="flex items-center gap-2">
        <EstimatePropertyIcon className="h-3 w-3 flex-shrink-0" />
        <span className="flex-grow truncate">{t("project_settings.estimates.no_estimate")}</span>
      </div>
    ),
  });

  const filteredOptions =
    query === "" ? options : options.filter((o) => o.query.toLowerCase().includes(query.toLowerCase()));

  const selectedEstimate = value && estimatePointById ? estimatePointById(value) : undefined;

  const onOpen = async () => {
    if (!currentActiveEstimateId && workspaceSlug && projectId)
      await getProjectEstimates(workspaceSlug.toString(), projectId);
  };

  const { handleClose, handleKeyDown, handleOnClick, searchInputKeyDown } = useDropdown({
    dropdownRef,
    inputRef,
    isOpen,
    onClose,
    onOpen,
    query,
    setIsOpen,
    setQuery,
  });

  const dropdownOnChange = (val: string | undefined) => {
    onChange(val);
    handleClose();
  };

  const comboButton = (
    <EstimateDropdownButton
      button={button}
      buttonClassName={buttonClassName}
      buttonContainerClassName={buttonContainerClassName}
      buttonVariant={buttonVariant}
      currentActiveEstimateType={currentActiveEstimate?.type}
      disabled={disabled}
      dropdownArrow={dropdownArrow}
      dropdownArrowClassName={dropdownArrowClassName}
      estimateLabel={t("project_settings.estimates.label")}
      hideIcon={hideIcon}
      isOpen={isOpen}
      onClick={handleOnClick}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      referenceElement={setReferenceElement}
      renderByDefault={renderByDefault}
      selectedEstimate={selectedEstimate}
      showTooltip={showTooltip}
    />
  );

  return (
    <ComboDropDown
      as="div"
      ref={dropdownRef}
      tabIndex={tabIndex}
      className={cn("h-full w-full", className)}
      value={value}
      onChange={dropdownOnChange}
      disabled={disabled}
      button={comboButton}
      renderByDefault={renderByDefault}
    >
      {isOpen && (
        <EstimateDropdownOptions
          attributes={attributes.popper}
          currentActiveEstimateId={currentActiveEstimateId}
          filteredOptions={filteredOptions}
          inputRef={inputRef}
          noEstimateLabel={t("project_settings.estimates.no_estimate")}
          noMatchingResults={t("common.search.no_matching_results")}
          popperElementRef={setPopperElement}
          placeholder={t("common.search.placeholder")}
          query={query}
          searchInputKeyDown={searchInputKeyDown}
          setQuery={setQuery}
          style={styles.popper}
        />
      )}
    </ComboDropDown>
  );
});
