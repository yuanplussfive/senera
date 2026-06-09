import type { HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../../lib/util";
import { MotionButton } from "../motion";
import { Tooltip } from "./Tooltip";

type IconButtonSize = "sm" | "md" | "lg";
type IconButtonTone = "neutral" | "muted" | "danger" | "primary";
type TooltipSide = "top" | "right" | "bottom" | "left";

export interface IconButtonProps extends Omit<HTMLMotionProps<"button">, "aria-label" | "children"> {
  label: string;
  children: ReactNode;
  size?: IconButtonSize;
  tone?: IconButtonTone;
  tooltip?: ReactNode;
  tooltipSide?: TooltipSide;
  tooltipShortcut?: string;
}

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "h-6 w-6 rounded",
  md: "h-8 w-8 rounded-lg",
  lg: "h-9 w-9 rounded-xl",
};

const toneClasses: Record<IconButtonTone, string> = {
  neutral: "text-ink-600 hover:bg-ink-900/[0.05] hover:text-ink-900",
  muted: "text-ink-400 hover:bg-ink-900/[0.05] hover:text-ink-800",
  danger: "text-ink-400 hover:bg-ink-900/[0.05] hover:text-brick-500",
  primary: "text-ink-500 hover:bg-ink-900/[0.05] hover:text-ink-800",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      label,
      children,
      className,
      size = "md",
      tone = "neutral",
      tooltip,
      tooltipSide = "bottom",
      tooltipShortcut,
      ...props
    },
    ref,
  ) => {
    const button = (
      <MotionButton
        ref={ref}
        aria-label={label}
        className={cn(
          "grid shrink-0 place-items-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70 disabled:pointer-events-none disabled:opacity-50",
          sizeClasses[size],
          toneClasses[tone],
          className,
        )}
        {...props}
      >
        {children}
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
