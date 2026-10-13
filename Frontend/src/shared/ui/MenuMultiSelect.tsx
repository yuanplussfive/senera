import { type ReactNode } from "react";
import { cn } from "../../lib/util";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./DropdownMenu";
import type { MenuSelectOption } from "./MenuSelect";
import { AppIcon } from "./AppIcon";

export interface MenuMultiSelectProps {
  values: readonly string[];
  placeholder: ReactNode;
  options: readonly MenuSelectOption[];
  disabled?: boolean;
  size?: "sm" | "md";
  emptyState?: ReactNode;
  ariaLabel?: string;
  onChange: (values: readonly string[]) => void;
}

const triggerSizeClassName = {
  sm: "h-8",
  md: "h-9",
} as const;

export function MenuMultiSelect({
  values,
  placeholder,
  options,
  disabled = false,
  size = "md",
  emptyState,
  ariaLabel,
  onChange,
}: MenuMultiSelectProps): JSX.Element {
  const selected = new Set(values);
  const selectedLabels = options.filter((option) => selected.has(option.value)).map((option) => option.label);
  const display = selectedLabels.join(", ");
  const accessibleValue = display || (typeof placeholder === "string" ? placeholder : undefined);
  const accessibleLabel = ariaLabel && accessibleValue ? `${ariaLabel}: ${accessibleValue}` : ariaLabel;

  const setChecked = (value: string, checked: boolean): void => {
    const next = new Set(values);
    if (checked) next.add(value);
    else next.delete(value);
    onChange(options.filter((option) => next.has(option.value)).map((option) => option.value));
  };

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
          )}
        >
          <span
            className={cn("flex min-w-0 flex-1 items-center truncate leading-none", !display && "text-content-muted")}
          >
            {display || placeholder}
          </span>
          <AppIcon icon="chevron-down" size={14} className="text-content-muted" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="scrollbar-thin max-h-[320px] min-w-[240px] overflow-y-auto">
        {options.length > 0 ? (
          options.map((option, index) => (
            <DropdownMenuCheckboxItem
              key={`${option.value || "empty"}-${index}`}
              checked={selected.has(option.value)}
              disabled={option.disabled}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => setChecked(option.value, checked === true)}
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))
        ) : emptyState != null ? (
          <DropdownMenuItem disabled>{emptyState}</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
