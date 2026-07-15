import { Check, ChevronDown, Loader2, X as XIcon } from "lucide-react";
import type { RunRecord } from "../../store/sessionStore";
import { cn, formatDuration, formatTime } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../shared/ui";
import type { RunSummary } from "./runSummary";

export function RunSummaryStrip({ run, summary }: { run: RunRecord; summary: RunSummary }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] tabular-nums text-ink-500">
      <span>
        {frontendMessage("workflow.summary.nodes")} {summary.completed}/{summary.total}
      </span>
      <span>
        {frontendMessage("workflow.summary.tools")} {summary.tools}
      </span>
      <span className={cn(summary.failed > 0 && "text-brick-600", run.status === "running" && "text-umber-600")}>
        {summary.duration || frontendMessage("workflow.run.inProgress")}
      </span>
    </div>
  );
}

export function RunSelector({
  runs,
  currentRunId,
  onSelect,
  pinnedToHistory,
}: {
  runs: RunRecord[];
  currentRunId?: string;
  onSelect: (id: string) => void;
  pinnedToHistory: boolean;
}): JSX.Element {
  const current = runs.find((r) => r.requestId === currentRunId) ?? runs[runs.length - 1];
  const reversed = [...runs].reverse();
  const currentIndex = runs.indexOf(current) + 1;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-start gap-2 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-ink-900/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70"
        >
          <RunStatusIcon status={current.status} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-ink-450">
              <span>
                {runs.length === 1
                  ? frontendMessage("workflow.run.only")
                  : !pinnedToHistory
                    ? frontendMessage("workflow.run.latest")
                    : frontendMessage("workflow.run.index", { index: currentIndex, total: runs.length })}
              </span>
              <span>· {formatDuration(current.startedAt, current.endedAt)}</span>
            </div>
            <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-5 text-ink-800">
              {current.input || frontendMessage("workflow.run.emptyInput")}
            </div>
          </div>
          <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="scrollbar-thin max-h-[60vh] w-[420px] overflow-y-auto">
        <DropdownMenuLabel>{frontendMessage("workflow.run.allRuns", { count: runs.length })}</DropdownMenuLabel>
        {reversed.map((run, index) => {
          const isCurrent = run.requestId === current.requestId;
          const indexFromOldest = runs.indexOf(run) + 1;
          return (
            <DropdownMenuItem
              key={run.requestId}
              onSelect={() => onSelect(run.requestId)}
              icon={isCurrent ? <Check className="h-3.5 w-3.5 text-ink-800" /> : <span className="block h-3.5 w-3.5" />}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="shrink-0 text-[10.5px] tabular-nums text-ink-400">
                  {index === 0 ? frontendMessage("workflow.run.latestShort") : `#${indexFromOldest}`}
                </span>
                <span className="truncate text-[12.5px]">
                  {run.input || frontendMessage("workflow.run.emptyInput")}
                </span>
              </div>
              <span className="ml-2 text-[10.5px] tabular-nums text-ink-400">{formatTime(run.startedAt)}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RunStatusIcon({ status, className }: { status: RunRecord["status"]; className?: string }): JSX.Element {
  if (status === "running") {
    return <Loader2 className={cn("h-3.5 w-3.5 shrink-0 animate-spin text-umber-600", className)} />;
  }
  if (status === "failed") {
    return <XIcon className={cn("h-3.5 w-3.5 shrink-0 text-brick-600", className)} />;
  }
  if (status === "cancelled") {
    return <XIcon className={cn("h-3.5 w-3.5 shrink-0 text-ink-400", className)} />;
  }
  return <Check className={cn("h-3.5 w-3.5 shrink-0 text-ink-500", className)} />;
}
