import { useId, useRef, useState, type ReactNode } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { useActiveOptionScroll } from "../selection/useActiveOptionScroll";
import { AppIcon } from "./AppIcon";
import type { MenuSelectProps } from "./MenuSelect";
import { Popover, PopoverAnchor, PopoverContent } from "./Popover";
import { ScrollArea } from "./ScrollArea";

export interface SearchSelectProps extends Omit<MenuSelectProps, "placeholder"> {
  placeholder: string;
  allowCustom?: boolean;
  onBlur?: () => void;
  footer?: (close: () => void) => ReactNode;
  side?: "top" | "bottom";
}

/** Free text is only accepted when the caller's value contract explicitly permits it. */
export function SearchSelect({
  value,
  options,
  placeholder,
  ariaLabel,
  disabled,
  allowCustom = false,
  onChange,
  onBlur,
  renderOption,
  renderValue,
  triggerClassName,
  contentClassName,
  emptyState,
  leading,
  trailing,
  footer,
  side = "bottom",
  size = "sm",
}: SearchSelectProps): JSX.Element {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const restoringFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const selected = options.find((option) => option.value === value);
  const search = (query ?? "").trim().toLocaleLowerCase();
  const matches = options.filter((option) =>
    `${option.label} ${option.description ?? ""} ${option.value}`.toLocaleLowerCase().includes(search),
  );
  const contentRef = useActiveOptionScroll(open ? `${active}:${search}` : undefined);
  const close = (): void => {
    setOpen(false);
    setQuery(null);
    setActive(-1);
  };
  const select = (next: string): void => {
    onChange(next);
    close();
    restoringFocus.current = true;
    inputRef.current?.focus();
    restoringFocus.current = false;
  };
  const finish = (): void => {
    if (allowCustom && query !== null && query.trim() !== value) onChange(query.trim());
    close();
    onBlur?.();
  };
  const move = (direction: number): void => {
    const enabled = matches.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0);
    const found = enabled.indexOf(active);
    const position = found < 0 && direction < 0 ? 0 : found;
    setActive(enabled[(position + direction + enabled.length) % enabled.length] ?? -1);
  };
  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(next) => {
        if (next) {
          setOpen(true);
          setQuery(null);
        } else finish();
      }}
    >
      <PopoverAnchor asChild>
        <div
          className={cn(
            "flex w-full min-w-0 items-center rounded-md border border-line bg-surface-panel focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-focus",
            size === "md" ? "h-9" : "h-8",
            disabled && "opacity-55",
            triggerClassName,
          )}
        >
          {leading ? <span className="ml-2.5 shrink-0">{leading}</span> : null}
          <div className="relative min-w-0 flex-1 self-stretch">
            <input
              ref={inputRef}
              role="combobox"
              aria-label={ariaLabel ?? placeholder}
              aria-expanded={open && !disabled}
              aria-controls={open ? id : undefined}
              aria-autocomplete="list"
              aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              value={query ?? (allowCustom ? value : open ? "" : (selected?.label ?? value))}
              placeholder={placeholder}
              className={cn(
                "h-full w-full min-w-0 bg-transparent px-2.5 text-[12.5px] text-content-primary outline-none placeholder:text-content-muted",
                !open && renderValue && value && "text-transparent",
              )}
              onFocus={(event) => {
                if (restoringFocus.current) return;
                setOpen(true);
                setQuery(null);
                event.currentTarget.select();
              }}
              onClick={() => setOpen(true)}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setActive(-1);
                setOpen(true);
              }}
              onBlur={() => {
                if (!open) onBlur?.();
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setOpen(true);
                  move(event.key === "ArrowDown" ? 1 : -1);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  close();
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  const option = matches[active];
                  if (open && option && !option.disabled) select(option.value);
                  else if (allowCustom) finish();
                }
              }}
            />
            {!open && renderValue && value ? (
              <span className="pointer-events-none absolute inset-0 flex min-w-0 items-center overflow-hidden px-2.5 text-[12.5px]">
                {renderValue(value, selected)}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            disabled={disabled}
            tabIndex={-1}
            aria-label={frontendMessage("settings.selection.open")}
            className="grid h-full w-8 shrink-0 place-items-center text-content-muted"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (open) close();
              else {
                inputRef.current?.focus();
                setOpen(true);
              }
            }}
          >
            {trailing ?? <AppIcon icon="chevron-down" size={14} />}
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        ref={contentRef}
        side={side}
        className={cn(
          "flex w-[var(--radix-popover-trigger-width)] min-w-[min(300px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-1",
          contentClassName,
        )}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          close();
        }}
        onInteractOutside={(event) => {
          if (event.target instanceof Node && inputRef.current?.parentElement?.parentElement?.contains(event.target))
            event.preventDefault();
        }}
      >
        <ScrollArea
          className="min-h-0 max-h-80 flex-1"
          viewportClassName="max-h-[min(320px,var(--radix-popover-content-available-height))]"
        >
          <div id={id} role="listbox" aria-label={ariaLabel ?? placeholder}>
            {matches.map((option, index) => (
              <button
                key={option.value}
                id={`${id}-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                aria-description={option.description}
                disabled={option.disabled}
                data-active-option={index === active ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12.5px] text-content-primary hover:bg-surface-hover disabled:opacity-45",
                  index === active && "bg-surface-hover",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => setActive(index)}
                onClick={() => select(option.value)}
              >
                <span className="min-w-0 flex-1">
                  {renderOption ? (
                    renderOption(option)
                  ) : (
                    <>
                      <span className="block break-words">{option.label}</span>
                      {option.description ? (
                        <span className="mt-0.5 block break-words text-[11px] text-content-muted">
                          {option.description}
                        </span>
                      ) : null}
                    </>
                  )}
                </span>
                {option.value === value ? (
                  <AppIcon icon="checkmark" size={14} className="shrink-0 text-content-muted" />
                ) : null}
              </button>
            ))}
            {matches.length === 0 ? (
              <p className="px-3 py-4 text-xs text-content-muted">
                {emptyState ??
                  frontendMessage(allowCustom ? "settings.selection.customHint" : "settings.selection.empty")}
              </p>
            ) : null}
          </div>
        </ScrollArea>
        {footer ? <div className="shrink-0">{footer(close)}</div> : null}
      </PopoverContent>
    </Popover>
  );
}
