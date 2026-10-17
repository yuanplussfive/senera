import type { ComponentProps } from "react";
import { cn } from "../../lib/util";
import { AppIcon } from "./AppIcon";

export type ActivityLoaderProps = Omit<ComponentProps<typeof AppIcon>, "icon"> & {
  /** Whether the radial glyph should rotate. Completed rows stay still. */
  active?: boolean;
};

/**
 * The shared waiting/loading glyph. Keeping the motion here makes thinking,
 * request setup, and generic loading states use the same stable geometry.
 */
export function ActivityLoader({ active = true, className, size = 16, ...props }: ActivityLoaderProps): JSX.Element {
  return (
    <AppIcon
      {...props}
      icon="progress"
      size={size}
      className={cn("senera-loader-glyph", active && "senera-activity-status-spin", className)}
      aria-hidden={props["aria-label"] || props["aria-labelledby"] ? undefined : true}
    />
  );
}
