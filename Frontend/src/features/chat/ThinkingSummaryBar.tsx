import { motion } from "framer-motion";
import { lazy, Suspense, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/util";
import { motionTimings, useMotionLevel } from "../../shared/motion";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { Spinner } from "../../shared/ui/Spinner";
import type { RunRecord } from "../../store/sessionStore";
import { summarizeRun } from "../workflow/runSummary";

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
  const live = run?.status === "running" || run?.status === "cancelling";

  if (!run || (run.status === "running" && presentation !== "live-final-answer") || (!live && run.steps.length === 0)) {
    return null;
  }

  const summary = summarizeRun(run);
  const label = live ? "Thinking..." : `Thinking ${summary.duration}`;

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
          >
            {live ? <Spinner size="xs" className="text-content-secondary" /> : null}
            <span className={cn("truncate", live && "thinking-summary-trigger__label--live")}>
              {live ? label : "Thinking"}
            </span>
            {!live ? <span className="shrink-0 tabular-nums text-content-muted">{summary.duration}</span> : null}
            {!live ? (
              <motion.span
                animate={{ rotate: expanded ? 180 : 0 }}
                transition={disableMotion || reduceMotion ? { duration: 0 } : motionTimings.base}
                className="inline-flex shrink-0"
              >
                <ChevronDown className="h-3 w-3 text-content-muted" />
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
          <div className="thinking-tool-popover__body max-h-[min(19rem,calc(100dvh-10rem))] overflow-y-auto px-3 py-2.5 scrollbar-thin">
            <Suspense fallback={<div className="h-20 animate-pulse rounded bg-surface-muted" aria-hidden="true" />}>
              <LazyThinkingToolChain run={run} />
            </Suspense>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
