import { type CSSProperties, type ReactNode } from "react";
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
import { IconButton } from "./IconButton";

export interface MenuSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface MenuSelectOptionAction {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
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
  renderOptionIcon?: (option: MenuSelectOption) => ReactNode;
  getOptionAction?: (option: MenuSelectOption) => MenuSelectOptionAction | undefined;
  triggerClassName?: string;
  contentClassName?: string;
  contentStyle?: CSSProperties;
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
  renderOptionIcon,
  getOptionAction,
  triggerClassName,
  contentClassName,
  contentStyle,
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
        style={contentStyle}
        className={cn(
          "max-h-[min(320px,var(--radix-popper-available-height))] min-w-[min(240px,var(--radix-popper-available-width))]",
          contentClassName,
        )}
      >
        {options.length > 0 ? (
          <DropdownMenuRadioGroup value={value} onValueChange={(next) => next !== value && onChange(next)}>
            {options.map((option, index) => {
              const action = getOptionAction?.(option);
              const selection = (
                <DropdownMenuRadioItem
                  value={option.value}
                  disabled={option.disabled}
                  aria-label={option.label}
                  aria-description={option.description}
                  icon={renderOptionIcon?.(option)}
                  className="min-w-0 flex-1"
                >
                  {renderOption ? renderOption(option) : option.label}
                </DropdownMenuRadioItem>
              );
              return (
                <div key={`${option.value || "empty"}-${index}`} className="flex items-center gap-1">
                  {selection}
                  {action ? (
                    <DropdownMenuItem
                      asChild
                      destructive={action.destructive}
                      disabled={action.disabled}
                      onSelect={(event) => {
                        event.preventDefault();
                        action.onSelect();
                      }}
                    >
                      <IconButton
                        label={action.label}
                        tooltip={action.label}
                        size="sm"
                        tone={action.destructive ? "danger" : "muted"}
                        disabled={action.disabled}
                        className="mr-1 min-h-7 min-w-7 justify-center p-1"
                      >
                        {action.icon}
                      </IconButton>
                    </DropdownMenuItem>
                  ) : null}
                </div>
              );
            })}
          </DropdownMenuRadioGroup>
        ) : emptyState != null ? (
          <DropdownMenuItem disabled>{emptyState}</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
