import type { SVGAttributes } from "react";
import { cn } from "../../lib/util";

export type SpinnerSize = "xs" | "sm" | "md";

const sizeClasses: Record<SpinnerSize, string> = {
  xs: "h-3 w-3",
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
};

/**
 * Quiet circular indicator for dense rows and buttons.
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
      viewBox="0 0 16 16"
      fill="none"
      focusable="false"
      aria-hidden="true"
      className={cn("senera-spinner shrink-0", sizeClasses[size], className)}
      {...props}
    >
      <circle className="senera-spinner-track" cx="8" cy="8" r="6" />
      <circle className="senera-spinner-indicator" cx="8" cy="8" r="6" />
    </svg>
  );
}
