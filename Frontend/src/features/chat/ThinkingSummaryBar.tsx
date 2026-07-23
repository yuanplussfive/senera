import { useState } from "react";
import { ChevronDown, GitBranch } from "lucide-react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { RunRecord } from "../../store/sessionStore";
import { summarizeRun } from "../workflow/runSummary";
import { readRunStatusLabel } from "../workflow/stepPresentation";
import { deriveFeedModel, statusTextClass, type FeedItem } from "../workflow/feedModel";
import { FeedItemIconCatalog } from "../workflow/feedPresentation";

/** A quiet disclosure for completed execution details. */
export function ThinkingSummaryBar({
  run,
  presentation = "terminal-only",
  onViewWorkflow,
}: {
  run?: RunRecord;
  presentation?: "terminal-only" | "live-final-answer";
  onViewWorkflow?: () => void;
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);

  if (!run || (run.status === "running" && presentation !== "live-final-answer") || run.steps.length === 0) return null;

  const summary = summarizeRun(run);
  const statusLabel = readRunStatusLabel(run.status);

  return (
    <div className="mt-1" data-ui-chrome>
      <button
        type="button"
        className="group inline-flex max-w-full items-center gap-1.5 rounded-md py-1 text-left text-[11.5px] text-ink-500 transition-colors hover:text-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="truncate">
          {statusLabel} · {frontendMessage("workflow.summary.steps", { count: summary.total })}
          {summary.duration ? ` · ${summary.duration}` : ""}
          {summary.failed > 0 ? (
            <span className="text-brick-600">
              {` · ${frontendMessage("workflow.summary.failed", { count: summary.failed })}`}
            </span>
          ) : null}
        </span>
        <ChevronDown className={cn("h-3 w-3 shrink-0 text-ink-400 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded ? <SummaryDetail run={run} onViewWorkflow={onViewWorkflow} /> : null}
    </div>
  );
}

function SummaryDetail({ run, onViewWorkflow }: { run: RunRecord; onViewWorkflow?: () => void }): JSX.Element {
  const model = deriveFeedModel(run);
  const items = model.groups.flatMap((group) => group.items);

  return (
    <div className="mt-1 border-y border-ink-200/70">
      <div className="scrollbar-thin max-h-[360px] divide-y divide-ink-200/60 overflow-y-auto">
        {items.map((item) => (
          <SummaryRow key={item.id} item={item} />
        ))}
      </div>

      {onViewWorkflow ? (
        <button
          type="button"
          onClick={onViewWorkflow}
          className="inline-flex w-full items-center gap-1.5 border-t border-ink-200/70 px-1 py-2 text-[11.5px] font-medium text-ink-600 transition-colors hover:text-ink-900"
        >
          <GitBranch className="h-3.5 w-3.5" />
          {frontendMessage("workflow.summary.viewFull")}
        </button>
      ) : null}
    </div>
  );
}

function SummaryRow({ item }: { item: FeedItem }): JSX.Element {
  const Icon = FeedItemIconCatalog[item.kind];
  return (
    <div className="flex min-w-0 items-start gap-2 px-1 py-2">
      <Icon className="mt-[2px] h-3.5 w-3.5 shrink-0 text-ink-400" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-ink-800">{item.title}</div>
        {item.subtitle ? <div className="mt-0.5 truncate text-[11.5px] text-ink-500">{item.subtitle}</div> : null}
      </div>
      {item.meta ? (
        <span className={cn("shrink-0 pt-px text-[11px]", statusTextClass(item.status))}>{item.meta}</span>
      ) : null}
    </div>
  );
}
