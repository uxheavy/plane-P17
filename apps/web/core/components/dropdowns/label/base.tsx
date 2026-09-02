/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useEffect, useRef, useState } from "react";
import type { Placement } from "@popperjs/core";
import { observer } from "mobx-react";
import { usePopper } from "react-popper";
import { Component, Loader } from "lucide-react";
import { Combobox } from "@headlessui/react";
import { getRandomLabelColor } from "@plane/constants";
// plane imports
import { useOutsideClickDetector } from "@plane/hooks";
import { useTranslation } from "@plane/i18n";
import { CheckIcon, SearchIcon, LabelPropertyIcon } from "@plane/propel/icons";
import type { IIssueLabel } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { IssueLabelsList } from "@/components/ui/labels-list";
// hooks
import { useDropdownKeyDown } from "@/hooks/use-dropdown-key-down";
import { usePlatformOS } from "@/hooks/use-platform-os";

export type TLabelDropdownBaseProps = {
  buttonClassName?: string;
  buttonContainerClassName?: string;
  createLabelEnabled?: boolean;
  disabled?: boolean;
  getLabelById: (labelId: string) => IIssueLabel | null;
  label?: React.ReactNode;
  labelIds: string[];
  onChange: (value: string[]) => void;
  onDropdownOpen?: () => void;
  placement?: Placement;
  createLabel?: (data: Partial<IIssueLabel>) => Promise<IIssueLabel>;
  tabIndex?: number;
  value: string[];
};

export const LabelDropdownBase = observer(function LabelDropdownBase(props: TLabelDropdownBaseProps) {
  const {
    buttonClassName,
    buttonContainerClassName,
    createLabelEnabled = false,
    disabled = false,
    getLabelById,
    label: customLabel,
    labelIds,
    onChange,
    onDropdownOpen,
    placement,
    createLabel,
    tabIndex,
    value,
  } = props;
  // refs
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // states
  const [query, setQuery] = useState("");
  const [referenceElement, setReferenceElement] = useState<HTMLButtonElement | null>(null);
  const [popperElement, setPopperElement] = useState<HTMLDivElement | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { isMobile } = usePlatformOS();
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
  // derived values
  const labelsList = labelIds.map((labelId) => getLabelById(labelId)).filter((label) => !!label);
  const labelsById = new Map(labelsList.map((label) => [label.id, label]));
  const childLabelsByParentId = new Map<string, IIssueLabel[]>();
  labelsList.forEach((label) => {
    if (!label.parent) return;
    const children = childLabelsByParentId.get(label.parent) ?? [];
    children.push(label);
    childLabelsByParentId.set(label.parent, children);
  });
  const selectableLabels = labelsList.flatMap((label) => {
    const children = childLabelsByParentId.get(label.id);
    if (children?.length) return children;
    return label.parent ? [] : [label];
  });
  const normalizedQuery = query.toLowerCase();
  const filteredOptions = selectableLabels.filter((label) => {
    const parentLabel = label.parent ? labelsById.get(label.parent) : undefined;
    return (
      label.name.toLowerCase().includes(normalizedQuery) || parentLabel?.name.toLowerCase().includes(normalizedQuery)
    );
  });
  const virtualOptions = filteredOptions.map((label) => label.id);

  const onOpen = () => {
    if (referenceElement) referenceElement.focus();
    onDropdownOpen?.();
  };

  const handleClose = () => {
    if (isDropdownOpen) setIsDropdownOpen(false);
    if (referenceElement) referenceElement.blur();
    setQuery("");
  };

  const toggleDropdown = () => {
    if (!isDropdownOpen) onOpen();
    setIsDropdownOpen((prevIsOpen) => !prevIsOpen);
  };

  const dropdownOnChange = (val: string[]) => {
    onChange(val);
  };

  const searchInputKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    const q = query.trim();
    if (q !== "" && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setQuery("");
      return;
    }
    if (
      q !== "" &&
      e.key === "Enter" &&
      !e.nativeEvent.isComposing &&
      createLabelEnabled &&
      filteredOptions.length === 0 &&
      !submitting
    ) {
      e.preventDefault();
      await handleAddLabel(q);
    }
  };
  const handleKeyDown = useDropdownKeyDown(toggleDropdown, handleClose);

  const handleOnClick = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.stopPropagation();
    e.preventDefault();
    toggleDropdown();
  };

  useOutsideClickDetector(dropdownRef, handleClose);

  useEffect(() => {
    if (isDropdownOpen && inputRef.current && !isMobile) {
      inputRef.current.focus();
    }
  }, [isDropdownOpen, isMobile]);

  const handleAddLabel = async (labelName: string) => {
    if (!createLabel || submitting) return;
    const name = labelName.trim();
    if (!name) return;
    setSubmitting(true);
    try {
      const existing = labelsList.find((l) => l.name.toLowerCase() === name.toLowerCase());
      const idToAdd = existing ? existing.id : (await createLabel({ name, color: getRandomLabelColor() })).id;
      onChange(Array.from(new Set([...value, idToAdd])));
      setQuery("");
    } catch (e) {
      console.error("Failed to create label", e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Combobox
      as="div"
      role="group"
      ref={dropdownRef}
      tabIndex={tabIndex}
      value={value}
      onChange={dropdownOnChange}
      onClose={handleClose}
      className="relative h-full flex-shrink-0"
      multiple
      disabled={disabled}
      onKeyDown={handleKeyDown}
      virtual={{ options: virtualOptions }}
    >
      <button
        type="button"
        ref={setReferenceElement}
        className={cn("flex h-full cursor-pointer items-center gap-2 text-11", buttonContainerClassName)}
        onClick={handleOnClick}
      >
        {customLabel ? (
          customLabel
        ) : value && value.length > 0 ? (
          <span className={cn("flex h-full items-center justify-center gap-2 text-11", buttonClassName)}>
            <IssueLabelsList labels={value.map((v) => labelsById.get(v)) ?? []} length={3} showLength />
          </span>
        ) : (
          <div
            className={cn(
              "flex h-full items-center justify-center gap-1 rounded-sm border-[0.5px] border-strong px-2 py-1 text-11 hover:bg-layer-1",
              buttonClassName
            )}
          >
            <LabelPropertyIcon className="h-3 w-3 flex-shrink-0" />
            <span>{t("labels")}</span>
          </div>
        )}
      </button>
      {isDropdownOpen && (
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
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search")}
              displayValue={(assigned: any) => assigned?.name}
              onKeyDown={searchInputKeyDown}
            />
          </div>
          {virtualOptions.length > 0 ? (
            <Combobox.Options as="ul" className="mt-2 h-48 space-y-1 overflow-y-scroll" modal={false} static>
              {({ option }: { option: string }) => {
                const label = labelsById.get(option)!;
                const parentLabel = label.parent ? labelsById.get(label.parent) : undefined;
                return (
                  <Combobox.Option
                    as="li"
                    key={label.id}
                    className={({ active }) =>
                      `${
                        active ? "bg-layer-1" : ""
                      } group flex w-full cursor-pointer items-center gap-2 truncate rounded-sm px-1 py-1.5 text-secondary select-none`
                    }
                    value={label.id}
                  >
                    {({ selected }) => (
                      <div className="flex w-full justify-between gap-2 rounded-sm">
                        <div className="flex items-center justify-start gap-2 truncate">
                          <span
                            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: label.color }}
                          />
                          {parentLabel && <Component className="h-3 w-3 flex-shrink-0" />}
                          <span className="truncate">
                            {parentLabel && <span className="text-tertiary">{parentLabel.name} / </span>}
                            {label.name}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center justify-center rounded-sm p-1">
                          <CheckIcon className={`h-3 w-3 ${selected ? "opacity-100" : "opacity-0"}`} />
                        </div>
                      </div>
                    )}
                  </Combobox.Option>
                );
              }}
            </Combobox.Options>
          ) : submitting ? (
            <Loader className="mt-2 h-3.5 w-3.5 animate-spin" />
          ) : createLabelEnabled ? (
            <button
              type="button"
              onClick={() => {
                if (!query.length) return;
                handleAddLabel(query);
              }}
              disabled={!query.length}
              className={`mt-2 text-left text-secondary ${query.length ? "cursor-pointer" : "cursor-default"}`}
            >
              {/* TODO: translate here */}
              {query.length ? (
                <>
                  + Add <span className="text-primary">&quot;{query}&quot;</span> to labels
                </>
              ) : (
                t("label.create.type")
              )}
            </button>
          ) : (
            <p className="mt-2 px-1.5 py-1 text-placeholder italic">{t("no_matching_results")}</p>
          )}
        </div>
      )}
    </Combobox>
  );
});
