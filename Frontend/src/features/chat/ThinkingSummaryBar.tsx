import { motion } from "framer-motion";
import { lazy, Suspense, useId, useState } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { motionTimings, textShimmerStyle, useMotionLevel } from "../../shared/motion";
import { AppIcon, ThinkingIndicator } from "../../shared/ui";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { StateView } from "../../shared/ui/StateView";
import type { RunRecord } from "../../store/sessionStore";
import { summarizeRun } from "../workflow/runSummary";
import { hasVisibleRunFeedback } from "../workflow/runActivityPresentation";

const LazyThinkingToolChain = lazy(() =>
  import("../workflow/AgentExecutionFeed").then((module) => ({ default: module.ThinkingToolChain })),
);

/** A quiet disclosure for completed execution details. */
export function ThinkingSummaryBar({
  run,
  presentation = "terminal-only",
}: {
  run?: RunRecord;
  presentation?: "terminal-only" | "live-final-answer";
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const { disableMotion, reduceMotion } = useMotionLevel();
  const live = run?.status === "running";
  const cancelling = run?.status === "cancelling";
  const hasFeedback = hasVisibleRunFeedback(run);

  if (
    !run ||
    ((live || cancelling) && hasFeedback) ||
    (live && presentation !== "live-final-answer" && !hasFeedback) ||
    (!live && !cancelling && run.steps.length === 0)
  ) {
    return null;
  }

  const summary = summarizeRun(run);
  const label = readThinkingLabel(run.status, summary.duration);
  const compactLabel = live || cancelling ? label : readTerminalLabel(run.status);

  return (
    <div className="mt-1.5" data-ui-chrome>
      <Popover open={expanded} onOpenChange={setExpanded}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="thinking-summary-trigger group inline-flex max-w-full items-center gap-1.5 rounded-sm py-0.5 text-left text-[13px] font-medium leading-[18px] text-content-secondary transition-colors hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
            aria-controls={detailId}
            aria-expanded={expanded}
            aria-label={label}
            data-run-status={run.status}
          >
            {live && !hasFeedback ? (
              <span
                className="activity-feed-row__icon text-accent-content thinking-status-icon thinking-status-icon--active"
                aria-hidden="true"
                data-live-activity-icon
                data-thinking-status-icon
                data-thinking-status-active
              >
                <ThinkingIndicator
                  size="compact"
                  showLabel={false}
                  className="thinking-indicator--inline"
                  aria-label={frontendMessage("chat.activity.thinking")}
                />
              </span>
            ) : cancelling ? (
              <AppIcon
                icon="cancel"
                size={14}
                className="shrink-0 text-content-secondary"
                data-cancelling-status-icon
                aria-hidden="true"
              />
            ) : null}
            <span
              className={cn("truncate", live && !hasFeedback && "motion-safe:animate-text-shimmer")}
              style={textShimmerStyle(compactLabel)}
              data-thinking-status-text
            >
              {compactLabel}
            </span>
            {!live && !cancelling ? (
              <motion.span
                animate={{ rotate: expanded ? 180 : 0 }}
                transition={disableMotion || reduceMotion ? { duration: 0 } : motionTimings.base}
                className="inline-flex shrink-0"
              >
                <AppIcon icon="chevron-down" size={12} className="text-content-muted" />
              </motion.span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent
          id={detailId}
          align="start"
          side="bottom"
          sideOffset={4}
          className="thinking-tool-popover w-[min(32rem,calc(100vw-2rem))] overflow-hidden p-0"
          data-thinking-tool-popover
        >
          <div className="thinking-tool-popover__body max-h-[min(19rem,calc(100dvh-10rem))] overflow-y-auto px-3 py-2.5 ">
            <Suspense
              fallback={
                <div className="h-20">
                  <StateView
                    status="loading"
                    title={frontendMessage("workflow.feed.trace")}
                    className="min-h-0 rounded bg-surface-muted py-2"
                  />
                </div>
              }
            >
              <LazyThinkingToolChain run={run} />
            </Suspense>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function readThinkingLabel(status: NonNullable<RunRecord>["status"], duration: string): string {
  switch (status) {
    case "running":
      return frontendMessage("session.subtitle.thinking");
    case "cancelling":
      return frontendMessage("workflow.run.status.cancelling");
    case "cancelled":
      return frontendMessage("workflow.run.status.cancelled");
    case "failed":
      return frontendMessage("workflow.run.status.failed");
    case "completed":
      return `Thinking ${duration}`;
  }
}

function readTerminalLabel(status: NonNullable<RunRecord>["status"]): string {
  switch (status) {
    case "cancelled":
      return frontendMessage("workflow.run.status.cancelled");
    case "failed":
      return frontendMessage("workflow.run.status.failed");
    default:
      return frontendMessage("session.subtitle.thinking");
  }
}
