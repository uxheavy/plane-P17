/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { ChevronDownIcon } from "@plane/propel/icons";
// plane imports
import type { IUserLite } from "@plane/types";
import { ComboDropDown } from "@plane/ui";
// helpers
import { cn, sortByCurrentUserThenSelected } from "@plane/utils";
// hooks
import { useDropdown } from "@/hooks/use-dropdown";
import { useMember } from "@/hooks/store/use-member";
import { useUser } from "@/hooks/store/user";
// local imports
import { DropdownButton } from "../buttons";
import { BUTTON_VARIANTS_WITH_TEXT } from "../constants";
import { ButtonAvatars } from "./avatar";
import { MemberOptions } from "./member-options";
import type { MemberDropdownProps } from "./types";

type TMemberDropdownBaseProps = {
  getUserDetails: (userId: string) => IUserLite | undefined;
  icon?: LucideIcon;
  memberIds?: string[];
  onClose?: () => void;
  onDropdownOpen?: () => void;
  optionsClassName?: string;
  renderByDefault?: boolean;
} & MemberDropdownProps;

export const MemberDropdownBase = observer(function MemberDropdownBase(props: TMemberDropdownBaseProps) {
  const { t } = useTranslation();
  const {
    button,
    buttonClassName,
    buttonContainerClassName,
    buttonVariant,
    className = "",
    disabled = false,
    dropdownArrow = false,
    dropdownArrowClassName = "",
    getUserDetails,
    hideIcon = false,
    icon,
    memberIds,
    multiple,
    onChange,
    onClose,
    onDropdownOpen,
    optionsClassName = "",
    placeholder = t("members"),
    placement,
    renderByDefault = true,
    showTooltip = false,
    showUserDetails = false,
    tabIndex,
    tooltipContent,
    value,
  } = props;
  // refs
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  // popper-js refs
  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);
  // states
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { workspaceSlug } = useParams();
  const { data: currentUser } = useUser();
  const {
    workspace: { isUserSuspended },
  } = useMember();

  const comboboxProps = {
    value,
    onChange,
    disabled,
    multiple,
  };

  const normalizedQuery = query.toLowerCase();
  const memberOptions = (memberIds ?? []).reduce<{ value: string }[]>((options, memberId) => {
    const member = getUserDetails(memberId);
    if (`${member?.display_name} ${member?.first_name} ${member?.last_name}`.toLowerCase().includes(normalizedQuery))
      options.push({ value: memberId });
    return options;
  }, []);
  const virtualOptions =
    sortByCurrentUserThenSelected(memberOptions, value, currentUser?.id)?.map((option) => option.value) ?? [];

  const { handleClose, handleKeyDown, handleOnClick } = useDropdown({
    dropdownRef,
    isOpen,
    onClose,
    setIsOpen,
  });

  const dropdownOnChange = (val: string & string[]) => {
    onChange(val);
    if (!multiple) handleClose();
  };

  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);

  const getDisplayName = (
    displayValue: string | string[] | null,
    includeUserDetails: boolean,
    emptyPlaceholder: string = ""
  ) => {
    if (Array.isArray(displayValue)) {
      if (displayValue.length > 0) {
        if (displayValue.length === 1) {
          return getUserDetails(displayValue[0])?.display_name || emptyPlaceholder;
        } else {
          return includeUserDetails ? `${displayValue.length} ${t("members").toLocaleLowerCase()}` : "";
        }
      } else {
        return emptyPlaceholder;
      }
    } else {
      if (includeUserDetails && displayValue) {
        return getUserDetails(displayValue)?.display_name || emptyPlaceholder;
      } else {
        return emptyPlaceholder;
      }
    }
  };

  const comboButton = button ? (
    <button
      ref={setReferenceElement}
      type="button"
      className={cn("clickable block h-full w-full outline-none", buttonContainerClassName)}
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
        "clickable block h-full max-w-full outline-none",
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
        className={cn("text-11", buttonClassName)}
        isActive={isOpen}
        tooltipHeading={placeholder}
        tooltipContent={
          tooltipContent ?? `${value?.length ?? 0} ${value?.length !== 1 ? t("assignees") : t("assignee")}`
        }
        showTooltip={showTooltip}
        variant={buttonVariant}
        renderToolTipByDefault={renderByDefault}
      >
        {!hideIcon && <ButtonAvatars showTooltip={showTooltip} userIds={value} icon={icon} />}
        {BUTTON_VARIANTS_WITH_TEXT.includes(buttonVariant) && (
          <span className="flex-grow truncate text-left text-body-xs-medium leading-5">
            {getDisplayName(value, showUserDetails, placeholder)}
          </span>
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
      {...comboboxProps}
      className={cn("h-full", className)}
      onChange={dropdownOnChange}
      onKeyDown={handleKeyDown}
      onClose={handleClose}
      button={comboButton}
      renderByDefault={renderByDefault}
      virtual={{
        options: virtualOptions,
        disabled: (memberId) => !!memberId && isUserSuspended(memberId, workspaceSlug?.toString()),
      }}
    >
      {isOpen && (
        <MemberOptions
          getUserDetails={getUserDetails}
          isOpen={isOpen}
          onDropdownOpen={onDropdownOpen}
          options={virtualOptions}
          optionsClassName={optionsClassName}
          placement={placement}
          referenceElement={referenceElement}
          query={query}
          setQuery={setQuery}
        />
      )}
    </ComboDropDown>
  );
});
