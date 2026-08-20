import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "../../lib/util";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { MotionDisclosure } from "../../shared/motion";
import type { ToolStageActivityPresentation } from "./toolStagePresentation";
import { ToolActionIcon } from "./ToolActionIcon";

export function ToolActivityGroup({
  activity,
  defaultOpen = false,
}: {
  activity: ToolStageActivityPresentation;
  defaultOpen?: boolean;
}): JSX.Element {
  const contentId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const live = activity.status === "running" || activity.status === "cancelling" || activity.status === "pending";
  const expandable = activity.counts.total > 1 || activity.actions.length > 1 || activity.counts.failed > 0;
  const content = (
    <>
      <ToolActivityIconStack activity={activity} />
      <span
        className={cn(
          "tool-activity-group__title min-w-0 flex-1 break-words text-[length:var(--theme-chat-assistant-font-size)] font-normal leading-[var(--theme-chat-assistant-line-height)] text-content-secondary",
          live && "tool-activity-group__title--live",
        )}
      >
        {activity.title}
      </span>
      {expandable ? (
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-200",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
      ) : (
        <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
    </>
  );

  return (
    <div
      className={cn("tool-activity-group relative min-w-0", live && "tool-activity-group--live")}
      data-tool-activity-group={activity.id}
      data-tool-activity-status={activity.status}
    >
      {expandable ? (
        <button
          type="button"
          className="tool-activity-group__trigger grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_14px] items-center gap-2 rounded-[5px] py-1.5 pl-0 pr-1 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
          aria-expanded={open}
          aria-controls={contentId}
          aria-label={activity.accessibleTitle}
          onClick={() => setOpen((value) => !value)}
          data-tool-activity-trigger
        >
          {content}
        </button>
      ) : (
        <div
          className="tool-activity-group__trigger grid min-h-8 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_14px] items-center gap-2 py-1.5 pl-0 pr-1 text-left"
          data-tool-activity-trigger
        >
          {content}
        </div>
      )}
      <MotionDisclosure id={contentId} open={expandable && open} className="tool-activity-group__content">
        <div className="ml-6 flex min-w-0 flex-wrap gap-x-4 gap-y-1 pb-2 pt-0.5 text-[11.5px] leading-5 text-content-muted">
          {activity.actions.map((action) => (
            <span
              key={action.id}
              className="inline-flex min-w-0 items-center gap-1.5"
              data-tool-activity-action={action.id}
            >
              <ToolActionIcon icon={action.icon} status="neutral" size="xs" showLiveIndicator={false} />
              <span className="break-words">{action.label}</span>
            </span>
          ))}
          {activity.counts.failed > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-content-muted" data-tool-activity-incomplete>
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
              {frontendFeatureMessage("workflow.stage.activityGroup.incomplete", {
                count: activity.counts.failed,
              })}
            </span>
          ) : null}
        </div>
      </MotionDisclosure>
    </div>
  );
}

function ToolActivityIconStack({ activity }: { activity: ToolStageActivityPresentation }): JSX.Element {
  const visibleIcons = activity.icons.slice(0, 3);
  const hasMoreIcons = activity.icons.length > visibleIcons.length;
  return (
    <span
      className="tool-activity-icon-stack inline-flex h-5 shrink-0 items-center gap-1.5"
      aria-hidden="true"
      data-tool-activity-icon-stack
    >
      {visibleIcons.map((icon, index) => (
        <span
          key={`${icon}:${index}`}
          className="tool-activity-icon shrink-0 text-content-muted"
          data-tool-activity-icon={icon}
        >
          <ToolActionIcon
            icon={icon}
            status={index === 0 && activity.status !== "failed" ? activity.status : "neutral"}
            size="sm"
            showLiveIndicator={index === 0}
          />
        </span>
      ))}
      {hasMoreIcons ? (
        <span
          className="inline-flex h-4 min-w-3 items-center justify-center text-[15px] leading-none text-content-muted"
          data-tool-activity-icon-overflow
        >
          …
        </span>
      ) : null}
    </span>
  );
}
