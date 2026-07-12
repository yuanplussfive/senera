import { ChevronDown, Check, Clock3, ListTree, Wrench, X as XIcon } from "lucide-react";
import type { RunRecord } from "../../store/sessionStore";
import { cn, formatDuration, formatTime } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  MetaLabel,
} from "../../shared/ui";
import type { RunSummary } from "./runSummary";

export function RunSummaryStrip({ run, summary }: { run: RunRecord; summary: RunSummary }): JSX.Element {
  return (
    <div className="mb-2 grid grid-cols-3 gap-1.5">
      <MetricChip
        icon={<ListTree className="h-3 w-3" />}
        label={frontendMessage("workflow.summary.nodes")}
        value={`${summary.completed}/${summary.total}`}
        tone={summary.failed > 0 ? "danger" : run.status === "running" ? "live" : "neutral"}
      />
      <MetricChip
        icon={<Wrench className="h-3 w-3" />}
        label={frontendMessage("workflow.summary.tools")}
        value={`${summary.tools}`}
      />
      <MetricChip
        icon={<Clock3 className="h-3 w-3" />}
        label={summary.startedAt}
        value={summary.duration || frontendMessage("workflow.run.inProgress")}
      />
    </div>
  );
}

function MetricChip({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: JSX.Element;
  label: string;
  value: string;
  tone?: "neutral" | "live" | "danger";
}): JSX.Element {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5",
        tone === "danger"
          ? "border-brick-100 bg-brick-50/70 text-brick-600"
          : tone === "live"
            ? "border-umber-200/60 bg-umber-50 text-umber-600"
            : "border-ink-200/60 bg-paper-100/70 text-ink-600",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 truncate font-mono text-[10px] text-current/70">{label}</span>
      <span className="ml-auto shrink-0 font-mono text-[10.5px] font-medium">{value}</span>
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
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group flex w-full items-start gap-2 rounded-lg border border-ink-200/60 bg-paper-100/70 px-3 py-2 text-left transition hover:border-ink-300 hover:bg-paper-100"
          >
            <div className="min-w-0 flex-1">
              <MetaLabel as="div" size="sm" className="flex items-center gap-1.5">
                <RunStatusBadge status={current.status} />
                <span>
                  {runs.length === 1
                    ? frontendMessage("workflow.run.only")
                    : !pinnedToHistory
                      ? frontendMessage("workflow.run.latest")
                      : frontendMessage("workflow.run.index", { index: currentIndex, total: runs.length })}
                </span>
                <span>· {formatDuration(current.startedAt, current.endedAt)}</span>
              </MetaLabel>
              <div className="mt-1 line-clamp-2 text-[12.5px] text-ink-800">
                {current.input || frontendMessage("workflow.run.emptyInput")}
              </div>
            </div>
            <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400 transition group-data-[state=open]:rotate-180" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[60vh] w-[420px] overflow-y-auto scrollbar-thin">
          <DropdownMenuLabel>{frontendMessage("workflow.run.allRuns", { count: runs.length })}</DropdownMenuLabel>
          {reversed.map((r, i) => {
            const isCurrent = r.requestId === current.requestId;
            const indexFromOldest = runs.indexOf(r) + 1;
            return (
              <DropdownMenuItem
                key={r.requestId}
                onSelect={() => onSelect(r.requestId)}
                icon={
                  isCurrent ? <Check className="h-3.5 w-3.5 text-terra-500" /> : <span className="block h-3.5 w-3.5" />
                }
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="font-mono text-[10px] text-ink-400">
                    {i === 0 ? frontendMessage("workflow.run.latestShort") : `#${indexFromOldest}`}
                  </span>
                  <span className="truncate text-[12.5px]">
                    {r.input || frontendMessage("workflow.run.emptyInput")}
                  </span>
                </div>
                <span className="ml-2 font-mono text-[10px] text-ink-400">{formatTime(r.startedAt)}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function RunStatusBadge({ status }: { status: RunRecord["status"] }): JSX.Element {
  if (status === "running") {
    return <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-umber-500 motion-safe:animate-pulse" />;
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-brick-200/60 bg-brick-50/60 px-1.5 py-0.5 text-[10.5px] text-brick-600">
        <XIcon className="h-2.5 w-2.5" /> {frontendMessage("workflow.run.status.failed")}
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-1.5 py-0.5 text-ink-500">
        {frontendMessage("workflow.run.status.cancelled")}
      </span>
    );
  }
  return <Check className="h-3 w-3 text-moss-500" />;
}
