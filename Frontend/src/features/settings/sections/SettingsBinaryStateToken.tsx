import { forwardRef } from "react";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";
import { cn } from "../../../lib/util";
import { StatusToken } from "../../../shared/ui";

export type SettingsBinaryState = "on" | "off";

const stateClassNames: Record<SettingsBinaryState, string> = {
  on: "border-emerald-500/50 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
  off: "border-line-strong bg-surface-panel text-content-muted",
};

interface SettingsBinaryStateTokenProps {
  state: SettingsBinaryState;
  ariaLabel?: string;
  className?: string;
}

/** Shared availability marker for settings indexes with a true binary state. */
export const SettingsBinaryStateToken = forwardRef<HTMLSpanElement, SettingsBinaryStateTokenProps>(
  ({ state, ariaLabel = frontendMessage(`settings.entityState.${state}`), className }, ref) => (
    <StatusToken
      ref={ref}
      className={cn("border", stateClassNames[state], className)}
      data-settings-state={state}
      aria-label={ariaLabel}
    >
      {frontendMessage(`settings.entityState.${state}`)}
    </StatusToken>
  ),
);
SettingsBinaryStateToken.displayName = "SettingsBinaryStateToken";
