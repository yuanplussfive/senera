import { type ReactNode } from "react";
import { cn } from "../../lib/util";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./DropdownMenu";
import { AppIcon } from "./AppIcon";

export interface MenuSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface MenuSelectProps {
  value: string;
  placeholder: ReactNode;
  options: readonly MenuSelectOption[];
  disabled?: boolean;
  size?: "sm" | "md";
  leading?: ReactNode;
  trailing?: ReactNode;
  renderValue?: (value: string, option: MenuSelectOption | undefined) => ReactNode;
  renderOption?: (option: MenuSelectOption) => ReactNode;
  triggerClassName?: string;
  contentClassName?: string;
  emptyState?: ReactNode;
  ariaLabel?: string;
  onChange: (value: string) => void;
}

const triggerSizeClassName = {
  sm: "h-8",
  md: "h-9",
} as const;

export function MenuSelect({
  value,
  placeholder,
  options,
  disabled = false,
  size = "sm",
  leading,
  trailing,
  renderValue,
  renderOption,
  triggerClassName,
  contentClassName,
  emptyState,
  ariaLabel,
  onChange,
}: MenuSelectProps): JSX.Element {
  const selected = options.find((option) => option.value === value);
  const renderedValue = value && renderValue ? renderValue(value, selected) : undefined;
  const display = renderedValue ?? selected?.label;
  const accessibleValue = selected?.label ?? (typeof placeholder === "string" ? placeholder : undefined);
  const accessibleLabel = ariaLabel
    ? accessibleValue && accessibleValue !== ariaLabel
      ? `${ariaLabel}: ${accessibleValue}`
      : ariaLabel
    : accessibleValue;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={accessibleLabel}
          className={cn(
            "flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-line bg-surface-panel px-2.5",
            triggerSizeClassName[size],
            "text-left text-[12.5px] text-content-primary outline-none transition-[background-color,border-color,box-shadow]",
            "hover:border-line-strong focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent-focus",
            "disabled:pointer-events-none disabled:opacity-55",
            triggerClassName,
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {leading ? (
              <span className="grid h-4 w-4 shrink-0 place-items-center text-content-muted">{leading}</span>
            ) : null}
            <span
              className={cn("flex min-w-0 flex-1 items-center truncate leading-none", !display && "text-content-muted")}
            >
              {display ?? placeholder}
            </span>
          </span>
          {trailing ?? <AppIcon icon="chevron-down" size={14} className="text-content-muted" aria-hidden="true" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn("scrollbar-thin max-h-[320px] min-w-[240px] overflow-y-auto", contentClassName)}
      >
        {options.length > 0 ? (
          <DropdownMenuRadioGroup value={value} onValueChange={(next) => next !== value && onChange(next)}>
            {options.map((option, index) => (
              <DropdownMenuRadioItem
                key={`${option.value || "empty"}-${index}`}
                value={option.value}
                disabled={option.disabled}
              >
                {renderOption ? renderOption(option) : option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : emptyState != null ? (
          <DropdownMenuItem disabled>{emptyState}</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
