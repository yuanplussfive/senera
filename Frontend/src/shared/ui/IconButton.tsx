import type { HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../../lib/util";
import { MotionButton } from "../motion";
import { useResponsiveMode } from "../responsive";
import { Tooltip } from "./Tooltip";
import { Spinner } from "./Spinner";

type IconButtonSize = "sm" | "md" | "lg";
type IconButtonTone = "neutral" | "muted" | "danger" | "primary";
type TooltipSide = "top" | "right" | "bottom" | "left";

export interface IconButtonProps extends Omit<HTMLMotionProps<"button">, "aria-label" | "children"> {
  label: string;
  children: ReactNode;
  /** Keeps the icon button stable while the action is in flight. */
  loading?: boolean;
  size?: IconButtonSize;
  tone?: IconButtonTone;
  tooltip?: ReactNode;
  tooltipSide?: TooltipSide;
  tooltipShortcut?: string;
  touchSafe?: boolean;
}

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "h-6 w-6 rounded",
  md: "h-8 w-8 rounded-lg",
  lg: "h-9 w-9 rounded-lg",
};

const toneClasses: Record<IconButtonTone, string> = {
  neutral: "text-content-secondary hover:bg-surface-hover hover:text-content-primary hover:shadow-panel",
  muted: "text-content-muted hover:bg-surface-hover hover:text-content-primary hover:shadow-panel",
  danger:
    "text-content-muted hover:bg-surface-hover hover:text-brick-500 hover:shadow-panel focus-visible:ring-brick-200",
  primary: "text-accent-content hover:bg-accent-surface hover:text-accent-content hover:shadow-panel",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      label,
      children,
      loading = false,
      className,
      size = "md",
      tone = "neutral",
      tooltip,
      tooltipSide = "bottom",
      tooltipShortcut,
      touchSafe = false,
      disabled = false,
      ...props
    },
    ref,
  ) => {
    const { isCoarsePointer } = useResponsiveMode();
    const touchSafeClassName = touchSafe && isCoarsePointer ? "min-h-11 min-w-11" : undefined;

    const button = (
      <MotionButton
        ref={ref}
        {...props}
        aria-label={label}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        className={cn(
          "grid shrink-0 cursor-pointer place-items-center transition-[background-color,border-color,box-shadow,color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:pointer-events-none disabled:opacity-50",
          sizeClasses[size],
          touchSafeClassName,
          toneClasses[tone],
          className,
        )}
      >
        {loading ? <Spinner size="sm" /> : children}
      </MotionButton>
    );

    if (!tooltip) {
      return button;
    }

    return (
      <Tooltip content={tooltip} side={tooltipSide} shortcut={tooltipShortcut}>
        {button}
      </Tooltip>
    );
  },
);
IconButton.displayName = "IconButton";
