import { useId, useState } from "react";
import { cn } from "../../lib/util";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { MotionDisclosure } from "../../shared/motion";
import { AppIcon } from "../../shared/ui";
import type { ToolStageActivityPresentation } from "./toolStagePresentation";
import { ToolActionIcon } from "./ToolActionIcon";
import { ToolActivityLabel } from "./ToolActivityLabel";

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
      <span className="activity-feed-row__content tool-activity-group__title break-words font-normal text-content-secondary">
        <ToolActivityLabel inspection={activity.inspection} fallback={activity.title} />
      </span>
      {expandable ? (
        <AppIcon
          icon="chevron-right"
          size={14}
          className={cn(
            "activity-feed-row__trailing text-content-muted transition-transform duration-200",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
      ) : (
        <span className="activity-feed-row__trailing" aria-hidden="true" />
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
          className="activity-feed-row tool-activity-group__trigger w-full rounded-[5px] pr-1 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
          aria-expanded={open}
          aria-controls={contentId}
          aria-label={activity.accessibleTitle}
          onClick={() => setOpen((value) => !value)}
          data-tool-activity-trigger
          data-activity-feed-row
        >
          {content}
        </button>
      ) : (
        <div
          className="activity-feed-row tool-activity-group__trigger w-full pr-1 text-left"
          data-tool-activity-trigger
          data-activity-feed-row
        >
          {content}
        </div>
      )}
      <MotionDisclosure id={contentId} open={expandable && open} className="tool-activity-group__content">
        <div
          className="tool-activity-viewport ml-6 flex min-w-0 flex-wrap gap-x-4 gap-y-1 pb-2 pr-1 pt-0.5 text-[11.5px] leading-5 text-content-muted"
          data-tool-activity-viewport
        >
          {activity.actions.map((action) => (
            <span
              key={action.id}
              className="inline-flex min-w-0 items-center gap-1.5"
              data-tool-activity-action={action.id}
            >
              <ToolActionIcon icon={action.icon} status="neutral" size="xs" />
              <ToolActivityLabel inspection={action.inspection} fallback={action.label} className="whitespace-nowrap" />
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
      className="activity-feed-row__icon tool-activity-icon-stack inline-flex shrink-0 items-center gap-1"
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
