import { useRef, useState } from "react";
import { useOutsideClickDetector } from "@plane/hooks";
import { IconButton } from "@plane/propel/icon-button";
import { CloseIcon, SearchIcon } from "@plane/propel/icons";
import { cn } from "@plane/utils";

type Props = {
  placeholder: string;
  searchQuery: string;
  updateSearchQuery: (value: string) => void;
};

export function ListSearchInput({ placeholder, searchQuery, updateSearchQuery }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useOutsideClickDetector(inputRef, () => {
    if (isOpen && searchQuery.trim() === "") setIsOpen(false);
  });

  return (
    <div className="flex">
      {!isOpen && (
        <IconButton
          variant="ghost"
          size="lg"
          className="my-auto -mr-1 shrink-0"
          onClick={() => {
            setIsOpen(true);
            inputRef.current?.focus();
          }}
          icon={SearchIcon}
        />
      )}
      <div
        className={cn(
          "flex w-0 items-center justify-start overflow-hidden rounded-md border border-transparent text-placeholder opacity-0 transition-[width] ease-linear",
          { "w-64 border-subtle px-2.5 py-1.5 opacity-100": isOpen }
        )}
      >
        <SearchIcon className="size-3.5" />
        <input
          ref={inputRef}
          className="ml-2 w-full max-w-[234px] border-none bg-transparent text-13 text-primary placeholder:text-placeholder focus:outline-none"
          placeholder={placeholder}
          value={searchQuery}
          onChange={(event) => updateSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            if (searchQuery.trim()) updateSearchQuery("");
            else {
              setIsOpen(false);
              inputRef.current?.blur();
            }
          }}
        />
        {isOpen && (
          <button
            type="button"
            className="grid place-items-center"
            onClick={() => {
              updateSearchQuery("");
              setIsOpen(false);
            }}
          >
            <CloseIcon className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}
