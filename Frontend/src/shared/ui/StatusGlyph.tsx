import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/util";
import { ExecutionStatusTones, type ActivityStatus } from "./executionStatusTone";

export type StatusGlyphLiveMotion = "ring" | "quiet";

/**
 * The one wrapper for an execution-state glyph.
 *
 * A status is a color plus an optional live treatment — never a different icon.
 * The caller owns the glyph, so a running tool keeps its identity instead of
 * swapping to a spinner and back on every event. The motion is explicit so
 * each surface can choose a ring or the quieter brand pulse.
 */
export function StatusGlyph({
  status,
  live = false,
  liveMotion = "ring",
  className,
  children,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  status: ActivityStatus;
  live?: boolean;
  liveMotion?: StatusGlyphLiveMotion;
  children: ReactNode;
}): JSX.Element {
  return (
    <span
      {...props}
      className={cn(
        "senera-status-glyph relative inline-flex shrink-0 items-center justify-center align-middle leading-none",
        ExecutionStatusTones[status].text,
        className,
      )}
      data-execution-status-icon={status}
      data-status-glyph-live={live || undefined}
      data-status-glyph-motion={live ? liveMotion : undefined}
    >
      {children}
      {live && liveMotion === "ring" ? (
        <span
          className="senera-status-glyph__ring senera-activity-status-spin tool-action-icon__activity-ring senera-activity-status-pulse"
          data-status-glyph-activity="live"
          data-tool-action-activity="live"
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}
