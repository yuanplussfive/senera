import type { TimelineStepStatus } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { MotionIconSwap } from "../../shared/motion";
import { AgentToolPresentationIcon } from "../../shared/workspace/AgentToolPresentationIcon";
import type { ToolStageIconName } from "./toolStageIconContract";

export function ToolActionIcon({
  icon,
  status,
  size = "sm",
  showLiveIndicator = true,
  className,
}: {
  icon: ToolStageIconName;
  status: TimelineStepStatus | "neutral";
  size?: "xs" | "sm";
  showLiveIndicator?: boolean;
  className?: string;
}): JSX.Element {
  const live = status === "running" || status === "cancelling";
  return (
    <span
      className={cn(
        "tool-action-icon relative inline-flex shrink-0 items-center justify-center align-middle leading-none",
        size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4",
        readActionIconTone(status),
        className,
      )}
      data-tool-action-icon={icon}
      data-tool-action-status={status}
      data-status-glyph-motion="quiet"
      aria-hidden="true"
    >
      <MotionIconSwap stateKey={`${icon}:${status}`} className={size === "xs" ? "h-3 w-3" : "h-4 w-4"}>
        <AgentToolPresentationIcon icon={icon} size="100%" strokeWidth={1.8} />
      </MotionIconSwap>
      {live && showLiveIndicator ? (
        <span
          className="senera-loading-pulse absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-accent-solid ring-2 ring-surface-canvas"
          data-tool-action-live-indicator
        />
      ) : null}
    </span>
  );
}

function readActionIconTone(status: TimelineStepStatus | "neutral"): string {
  if (status === "running" || status === "cancelling") return "text-accent-content";
  return "text-content-muted";
}
