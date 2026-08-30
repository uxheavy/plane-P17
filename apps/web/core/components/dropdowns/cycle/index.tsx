/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useTranslation } from "@plane/i18n";
// ui
import { CycleIcon, ChevronDownIcon } from "@plane/propel/icons";
import { ComboDropDown } from "@plane/ui";
// helpers
import { cn } from "@plane/utils";
// hooks
import { useCycle } from "@/hooks/store/use-cycle";
import { useDropdown } from "@/hooks/use-dropdown";
// local components and constants
import { DropdownButton } from "../buttons";
import { BUTTON_VARIANTS_WITH_TEXT } from "../constants";
import type { TDropdownProps } from "../types";
import { CycleOptions } from "./cycle-options";

type Props = TDropdownProps & {
  button?: ReactNode;
  dropdownArrow?: boolean;
  dropdownArrowClassName?: string;
  onChange: (val: string | null) => void;
  onClose?: () => void;
  projectId: string | undefined;
  value: string | null;
  canRemoveCycle?: boolean;
  renderByDefault?: boolean;
  currentCycleId?: string;
};

export const CycleDropdown = observer(function CycleDropdown(props: Props) {
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
    canRemoveCycle = true,
    renderByDefault = true,
    currentCycleId,
  } = props;
  // i18n
  const { t } = useTranslation();
  // states

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { workspaceSlug } = useParams();
  const { fetchAllCycles, getCycleById, getCycleNameById, getProjectCycleIds } = useCycle();
  // refs
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  // popper-js refs
  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);

  const selectedName = value ? getCycleNameById(value) : null;

  const {
    handleClose: closeDropdown,
    handleKeyDown,
    handleOnClick,
  } = useDropdown({
    dropdownRef,
    isOpen,
    onClose,
    setIsOpen,
  });

  const handleClose = () => {
    setQuery("");
    closeDropdown();
  };

  const dropdownOnChange = (val: string | null) => {
    onChange(val);
    handleClose();
  };

  const projectCycleIds = projectId ? getProjectCycleIds(projectId) : null;
  const virtualOptions: (string | null)[] = (projectCycleIds ?? []).filter((cycleId) => {
    const cycle = getCycleById(cycleId);
    if (currentCycleId === cycleId || cycle?.status?.toLowerCase() === "completed") return false;
    return cycle?.name.toLowerCase().includes(query.toLowerCase());
  });
  if (canRemoveCycle && t("cycle.no_cycle").toLowerCase().includes(query.toLowerCase())) virtualOptions.unshift(null);

  useEffect(() => {
    if (isOpen && workspaceSlug && projectId && projectCycleIds === null)
      fetchAllCycles(workspaceSlug.toString(), projectId);
  }, [fetchAllCycles, isOpen, projectCycleIds, projectId, workspaceSlug]);

  const comboButton = button ? (
    <button
      ref={setReferenceElement}
      type="button"
      className={cn("clickable block h-full w-full outline-none hover:bg-layer-1", buttonContainerClassName)}
      onClick={handleOnClick}
      disabled={disabled}
      tabIndex={tabIndex}
    >
      {button}
    </button>
  ) : (
    <button
      ref={setReferenceElement}
      type="button"
      className={cn(
        "clickable block h-full max-w-full outline-none hover:bg-layer-1",
        {
          "cursor-not-allowed text-secondary": disabled,
          "cursor-pointer": !disabled,
        },
        buttonContainerClassName
      )}
      onClick={handleOnClick}
      disabled={disabled}
      tabIndex={tabIndex}
    >
      <DropdownButton
        className={buttonClassName}
        isActive={isOpen}
        tooltipHeading={t("common.cycle")}
        tooltipContent={selectedName ?? placeholder}
        showTooltip={showTooltip}
        variant={buttonVariant}
        renderToolTipByDefault={renderByDefault}
      >
        {!hideIcon && <CycleIcon className="h-3 w-3 flex-shrink-0" />}
        {BUTTON_VARIANTS_WITH_TEXT.includes(buttonVariant) && (!!selectedName || !!placeholder) && (
          <span className="max-w-40 truncate">{selectedName ?? placeholder}</span>
        )}
        {dropdownArrow && (
          <ChevronDownIcon className={cn("h-2.5 w-2.5 flex-shrink-0", dropdownArrowClassName)} aria-hidden="true" />
        )}
      </DropdownButton>
    </button>
  );

  return (
    <ComboDropDown
      as="div"
      role="group"
      ref={dropdownRef}
      className={cn("h-full", className)}
      value={value}
      onChange={dropdownOnChange}
      disabled={disabled}
      onKeyDown={handleKeyDown}
      onClose={handleClose}
      button={comboButton}
      renderByDefault={renderByDefault}
      virtual={{ options: virtualOptions }}
    >
      {isOpen && projectId && (
        <CycleOptions
          isOpen={isOpen}
          placement={placement}
          referenceElement={referenceElement}
          options={virtualOptions}
          query={query}
          setQuery={setQuery}
        />
      )}
    </ComboDropDown>
  );
});
