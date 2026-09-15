import { type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/util";

export type SwitchSize = "sm" | "md";

export interface SwitchTrackProps {
  checked: boolean;
  disabled?: boolean;
  size?: SwitchSize;
  className?: string;
}

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-checked" | "aria-label" | "onClick" | "onChange" | "type"
> {
  checked: boolean;
  ariaLabel: string;
  onCheckedChange: (checked: boolean) => void;
  size?: SwitchSize;
  trackClassName?: string;
}

const trackSizeClassName: Record<SwitchSize, string> = {
  sm: "h-5 w-9",
  md: "h-6 w-11",
};

const thumbSizeClassName: Record<SwitchSize, string> = {
  sm: "h-4 w-4 left-0.5 top-0.5",
  md: "h-5 w-5 left-0.5 top-0.5",
};

const checkedTranslateClassName: Record<SwitchSize, string> = {
  sm: "translate-x-4",
  md: "translate-x-5",
};

export function SwitchTrack({ checked, disabled = false, size = "sm", className }: SwitchTrackProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-state={checked ? "checked" : "unchecked"}
      className={cn(
        "relative inline-block shrink-0 rounded-full transition-[background-color,opacity] duration-150 ease-out",
        trackSizeClassName[size],
        checked ? "bg-accent-solid" : "bg-ink-300",
        disabled && "opacity-45",
        className,
      )}
    >
      <span
        className={cn(
          "absolute rounded-full bg-paper-50 shadow-sm transition-transform duration-150 ease-out",
          thumbSizeClassName[size],
          checked && checkedTranslateClassName[size],
        )}
      />
    </span>
  );
}

export function Switch({
  checked,
  disabled = false,
  ariaLabel,
  onCheckedChange,
  size = "sm",
  trackClassName,
  className,
  ...buttonProps
}: SwitchProps): JSX.Element {
  return (
    <button
      {...buttonProps}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center",
        "outline-none transition-[background-color,box-shadow,transform] duration-150 ease-out",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent-border active:scale-[0.98]",
        "disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
      onClick={() => onCheckedChange(!checked)}
    >
      <SwitchTrack checked={checked} disabled={disabled} size={size} className={trackClassName} />
    </button>
  );
}
