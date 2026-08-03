import { ChevronDown } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "../../lib/util";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "./DropdownMenu";
import type { MenuSelectOption } from "./MenuSelect";

export interface MenuMultiSelectProps {
  values: readonly string[];
  placeholder: ReactNode;
  options: readonly MenuSelectOption[];
  disabled?: boolean;
  ariaLabel?: string;
  onChange: (values: readonly string[]) => void;
}

export function MenuMultiSelect({
  values,
  placeholder,
  options,
  disabled = false,
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
            "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-ink-200 bg-paper-50 px-2.5",
            "text-left text-[12.5px] text-ink-800 outline-none transition-[background-color,border-color,box-shadow]",
            "hover:border-accent-border-strong focus-visible:border-accent-border focus-visible:ring-2 focus-visible:ring-accent-focus",
            "disabled:pointer-events-none disabled:opacity-55",
          )}
        >
          <span className={cn("min-w-0 flex-1 truncate", !display && "text-ink-350")}>{display || placeholder}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-350" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[320px] min-w-[240px] overflow-y-auto">
        {options.map((option, index) => (
          <DropdownMenuCheckboxItem
            key={`${option.value || "empty"}-${index}`}
            checked={selected.has(option.value)}
            disabled={option.disabled}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => setChecked(option.value, checked === true)}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
