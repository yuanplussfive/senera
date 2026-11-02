import { cn } from "../../lib/util";
import { AppIcon, type AppIconName } from "./AppIcon";
import { ExecutionStatusTones, type ActivityStatus, type ActivityStatusMotion } from "./executionStatusTone";
import type { ComponentProps } from "react";

export type { ActivityStatus, ActivityStatusMotion } from "./executionStatusTone";

const iconByStatus: Readonly<Record<ActivityStatus, AppIconName>> = {
  pending: "circle-dot",
  running: "progress",
  cancelling: "progress",
  done: "check",
  completed: "check",
  failed: "alert",
  cancelled: "cancel",
  neutral: "circle",
};

/** Compact execution-state icon with an explicit live motion treatment. */
export function ActivityStatusIcon({
  status,
  size = 15,
  motion = "spin",
  className,
  ...props
}: Omit<ComponentProps<typeof AppIcon>, "icon"> & {
  status: ActivityStatus;
  motion?: ActivityStatusMotion;
}): JSX.Element {
  const live = status === "running" || status === "cancelling";
  const motionClass = live
    ? motion === "spin"
      ? "senera-activity-status-spin"
      : motion === "pulse"
        ? "senera-activity-status-pulse"
        : undefined
    : undefined;
  return (
    <AppIcon
      {...props}
      icon={iconByStatus[status]}
      size={size}
      className={cn(ExecutionStatusTones[status].text, motionClass, className)}
      data-execution-status-icon={status}
      aria-hidden={props["aria-label"] || props["aria-labelledby"] ? undefined : true}
    />
  );
}
