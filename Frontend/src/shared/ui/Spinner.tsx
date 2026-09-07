import type { SVGAttributes } from "react";
import { cn } from "../../lib/util";

export type SpinnerSize = "xs" | "sm" | "md";

const sizeClasses: Record<SpinnerSize, string> = {
  xs: "h-3 w-4",
  sm: "h-3.5 w-5",
  md: "h-4 w-6",
};

const spinnerTrace = "M1 8 C4 8 4 8 6 5 C8 2 9 2 11 8 C13 14 14 14 16 8 C18 2 19 2 21 5 C23 8 24 8 27 8";

/**
 * Compact form of the Senera resonance trace for dense rows and buttons.
 * The viewBox remains small and stable, while the stroke carries the
 * current text color from its parent.
 */
export function Spinner({
  size = "sm",
  className,
  ...props
}: {
  size?: SpinnerSize;
  className?: string;
} & Omit<SVGAttributes<SVGSVGElement>, "className">): JSX.Element {
  return (
    <svg
      viewBox="0 0 28 16"
      fill="none"
      focusable="false"
      aria-hidden="true"
      className={cn("senera-spinner-trace motion-safe:animate-spin shrink-0", sizeClasses[size], className)}
      {...props}
    >
      <path d={spinnerTrace} />
    </svg>
  );
}
