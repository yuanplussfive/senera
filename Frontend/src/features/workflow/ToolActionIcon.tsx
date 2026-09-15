import type { TimelineStepStatus } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { MotionIconSwap } from "../../shared/motion";
import { AppIcon } from "../../shared/ui/AppIcon";
import { ToolStageIconCatalog } from "./feedPresentation";
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
  const visual = ToolStageIconCatalog[icon];
  const live = status === "running" || status === "cancelling";
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4",
        readActionIconTone(status),
        className,
      )}
      data-tool-action-icon={icon}
      data-tool-action-status={status}
      aria-hidden="true"
    >
      <MotionIconSwap stateKey={`${visual}:${status}`} className={size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"}>
        <AppIcon icon={visual} size="100%" strokeWidth={1.8} />
      </MotionIconSwap>
      {live && showLiveIndicator ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-accent-solid ring-2 ring-surface-canvas motion-safe:animate-pulse"
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
