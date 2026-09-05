import type { SVGAttributes } from "react";
import { cn } from "../../lib/util";

export type LoadingSignalSize = "sm" | "md" | "lg";

const sizeClasses: Record<LoadingSignalSize, { trace: string }> = {
  sm: { trace: "h-4 w-9" },
  md: { trace: "h-5 w-12" },
  lg: { trace: "h-7 w-16" },
};

const orbitSizeClasses: Record<LoadingSignalSize, string> = {
  sm: "h-4 w-6",
  md: "h-5 w-8",
  lg: "h-7 w-12",
};

const primaryTrace =
  "M2 12 C10 12 14 12 18 7 C22 2 26 3 30 12 C34 21 38 22 43 12 C48 2 52 2 57 12 C62 22 68 22 73 12 C78 2 84 4 94 12";
const secondaryTrace =
  "M2 12 C10 12 14 12 19 16 C24 20 28 20 33 12 C38 4 42 3 47 12 C52 21 57 21 62 12 C67 3 72 4 77 8 C82 12 87 12 94 12";

const horizontalOrbit = "M15 12 C25 2 38 2 48 12 C58 22 71 22 81 12 C71 2 58 2 48 12 C38 22 25 22 15 12";
const verticalOrbit = "M48 2 C40 5 40 9 48 12 C56 15 56 19 48 22 C40 19 40 15 48 12 C56 9 56 5 48 2";

export function ResonanceTrace({
  size = "md",
  state = "running",
  className,
  ...props
}: {
  size?: LoadingSignalSize;
  state?: "running" | "settled";
  className?: string;
} & Omit<SVGAttributes<SVGSVGElement>, "className">): JSX.Element {
  return (
    <svg
      viewBox="0 0 96 24"
      fill="none"
      focusable="false"
      aria-hidden="true"
      className={cn("senera-resonance-trace", sizeClasses[size].trace, state === "settled" && "is-settled", className)}
      {...props}
    >
      <path className="senera-resonance-trace-shadow" d={primaryTrace} />
      <path className="senera-resonance-trace-wave senera-resonance-trace-wave-primary" d={primaryTrace} />
      <path className="senera-resonance-trace-wave senera-resonance-trace-wave-secondary" d={secondaryTrace} />
      <circle className="senera-resonance-trace-impact" cx="94" cy="12" r="3.5" />
      <circle className="senera-resonance-trace-node" cx="94" cy="12" r="1.7" />
    </svg>
  );
}

/**
 * Refresh has a different meaning from loading: two independent sources
 * re-enter the same center and reconcile. Native SVG motion keeps the paths
 * deterministic while the impact ring gives the collision a short, legible
 * finish without rotating a generic icon.
 */
export function RefreshOrbit({
  size = "sm",
  className,
  ...props
}: {
  size?: LoadingSignalSize;
  className?: string;
} & Omit<SVGAttributes<SVGSVGElement>, "className">): JSX.Element {
  return (
    <svg
      viewBox="0 0 96 24"
      fill="none"
      focusable="false"
      aria-hidden="true"
      className={cn("senera-refresh-orbit", orbitSizeClasses[size], className)}
      {...props}
    >
      <path className="senera-refresh-orbit-track" d={horizontalOrbit} />
      <path className="senera-refresh-orbit-track senera-refresh-orbit-track-secondary" d={verticalOrbit} />
      <circle className="senera-refresh-orbit-particle senera-refresh-orbit-particle-primary" cx="0" cy="0" r="1.8">
        <animateMotion dur="1.15s" repeatCount="indefinite" path={horizontalOrbit} />
      </circle>
      <circle className="senera-refresh-orbit-particle senera-refresh-orbit-particle-secondary" cx="0" cy="0" r="1.55">
        <animateMotion dur="1.15s" begin="-0.02s" repeatCount="indefinite" path={verticalOrbit} />
      </circle>
      <circle className="senera-refresh-orbit-collision" cx="48" cy="12" r="3.2" />
    </svg>
  );
}

/**
 * A wordless Senera loading state. It deliberately uses the brand's
 * asymmetric double trace instead of a logo, spinner or status icon so the
 * same motion can live in a full surface, a row, or a button.
 */
export function LoadingSignal({
  size = "md",
  label,
  className,
}: {
  size?: LoadingSignalSize;
  label?: string;
  className?: string;
}): JSX.Element {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} role={label ? "status" : undefined}>
      <ResonanceTrace size={size} />
      {label ? <span className="text-[12.5px] text-content-secondary">{label}</span> : null}
    </span>
  );
}
