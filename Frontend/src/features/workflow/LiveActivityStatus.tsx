import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { StableActivitySlot, textShimmerStyle } from "../../shared/motion";
import { AppIcon, ThinkingIndicator, type AppIconName } from "../../shared/ui";

export function LiveActivityStatus({
  label = frontendMessage("chat.activity.thinking"),
  icon = "brain",
  dataInitialThinking = false,
  dataFallback = false,
  active = true,
}: {
  label?: string;
  icon?: AppIconName;
  dataInitialThinking?: boolean;
  dataFallback?: boolean;
  active?: boolean;
}): JSX.Element {
  const usesThinkingIndicator = active && (icon === "brain" || icon === "thinking");

  return (
    <StableActivitySlot
      stateKey={dataInitialThinking ? "initial-thinking" : dataFallback ? "execution-waiting" : icon}
      preserveChildAnimations={usesThinkingIndicator}
    >
      <div
        className={cn(
          "activity-feed-row live-activity-status text-content-secondary",
          usesThinkingIndicator && "live-activity-status--thinking",
        )}
        role={active ? "status" : undefined}
        aria-live={active ? "polite" : undefined}
        aria-hidden={active ? undefined : true}
        data-activity-feed-row
        data-live-activity-status
        data-initial-thinking={dataInitialThinking || undefined}
        data-live-activity-fallback={dataFallback || undefined}
      >
        {usesThinkingIndicator ? (
          <span
            className="live-activity-status__indicator thinking-status-icon thinking-status-icon--active"
            data-thinking-status-icon
            data-live-activity-icon
            data-thinking-status-active
          >
            <ThinkingIndicator className="thinking-indicator--inline" aria-label={label} />
          </span>
        ) : (
          <span
            className={cn(
              "activity-feed-row__icon text-content-secondary thinking-status-icon",
              active && "thinking-status-icon--active",
            )}
            aria-hidden="true"
            data-thinking-status-icon
            data-live-activity-icon
            data-thinking-status-active={active || undefined}
          >
            {icon === "brain" || icon === "thinking" ? (
              <AppIcon icon="brain" size={16} />
            ) : (
              <AppIcon icon={icon} size={14} />
            )}
          </span>
        )}
        {!usesThinkingIndicator ? (
          <span
            className={cn("activity-feed-row__content truncate", active && "motion-safe:animate-text-shimmer")}
            style={textShimmerStyle(label)}
            data-thinking-status-text
          >
            {active ? label : null}
          </span>
        ) : null}
        <span className="activity-feed-row__trailing" aria-hidden="true" />
      </div>
    </StableActivitySlot>
  );
}
