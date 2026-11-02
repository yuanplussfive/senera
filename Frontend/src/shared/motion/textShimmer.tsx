import type { CSSProperties } from "react";
import { cn } from "../../lib/util";
import { useMotionLevel } from "./MotionLevelContext";

const TextScanBeam = "0.45em";

export function textShimmerStyle(_text?: string): CSSProperties {
  return {
    "--senera-text-scan-beam": TextScanBeam,
  } as CSSProperties;
}

export function TextShimmer({
  text,
  active,
  className,
}: {
  text: string;
  active: boolean;
  className?: string;
}): JSX.Element {
  const { disableMotion, reduceMotion } = useMotionLevel();
  const animate = active && !disableMotion && !reduceMotion;

  return (
    <span
      className={cn("whitespace-pre-wrap break-words", animate && "animate-text-shimmer", className)}
      data-text-shimmer={animate || undefined}
    >
      {text}
    </span>
  );
}
