import type { SVGProps } from "react";
import { cn } from "../../lib/util";

export interface SeneraActivityMarkProps extends Omit<SVGProps<SVGSVGElement>, "height" | "width"> {
  /** The square visual size in CSS pixels or any CSS length accepted by SVG. */
  size?: number | string;
  /** Keeps the mark visible while enabling the continuous live signal motion. */
  active?: boolean;
}

/**
 * The compact Senera signal used for activity-category glyphs.
 *
 * It is intentionally a real mark instead of a generic activity icon. Live
 * wrappers can opt into the dash flow while completed rows remain still.
 */
export function SeneraActivityMark({
  size = 16,
  active = true,
  className,
  "aria-label": ariaLabel,
  ...props
}: SeneraActivityMarkProps): JSX.Element {
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn("senera-activity-mark", active && "senera-activity-mark--active", className)}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      focusable="false"
      data-senera-activity-mark
      data-senera-activity-active={active || undefined}
    >
      <path className="senera-activity-mark__main" d="M2.5 12h3l2-5 3.3 10 2.8-8.2 2.2 4.2h2.7" />
      <path className="senera-activity-mark__tail" d="M17.2 13 19 8.8l1.4 3.2h1.1" />
      <circle className="senera-activity-mark__dot" cx="21.5" cy="12" r="1.25" />
    </svg>
  );
}
