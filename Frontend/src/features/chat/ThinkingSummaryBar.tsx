import { useState } from "react";
import { ChevronDown, GitBranch, Wrench } from "lucide-react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { RunRecord } from "../../store/sessionStore";
import { summarizeRun } from "../workflow/runSummary";
import { readRunStatusLabel } from "../workflow/stepPresentation";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../../shared/ui";
import { deriveFeedModel, statusTextClass, type FeedItem } from "../workflow/feedModel";

/** A quiet disclosure for completed execution details. */
export function ThinkingSummaryBar({
  run,
  onViewWorkflow,
}: {
  run?: RunRecord;
  onViewWorkflow?: () => void;
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);

  if (!run || run.status === "running" || run.steps.length === 0) return null;

  const summary = summarizeRun(run);
  const statusLabel = readRunStatusLabel(run.status);

  return (
    <DropdownMenu open={expanded} onOpenChange={setExpanded} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group mt-1.5 inline-flex max-w-full items-center gap-1.5 py-1 text-left text-[11.5px] text-ink-500 transition-colors hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70"
          aria-expanded={expanded}
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
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        collisionPadding={12}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="scrollbar-thin max-h-[min(520px,calc(100vh-96px))] w-[min(620px,calc(100vw-32px))] overflow-y-auto p-0"
      >
        <SummaryDetail run={run} onViewWorkflow={onViewWorkflow} onClose={() => setExpanded(false)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SummaryDetail({
  run,
  onViewWorkflow,
  onClose,
}: {
  run: RunRecord;
  onViewWorkflow?: () => void;
  onClose: () => void;
}): JSX.Element {
  const model = deriveFeedModel(run);
  const items = model.groups.flatMap((group) => group.items);

  return (
    <div className="bg-paper-50 px-3 py-2.5">
      <div className="flex items-baseline gap-2 pb-2">
        <div className="text-[12.5px] font-medium text-ink-850">{frontendMessage("workflow.panel.title")}</div>
        <div className="truncate text-[10.5px] tabular-nums text-ink-400">
          {frontendMessage("workflow.summary.steps", { count: run.steps.length })} · {readRunStatusLabel(run.status)}
        </div>
      </div>
      <div className="divide-y divide-ink-200/60 border-y border-ink-200/70">
        {items.map((item) => (
          <SummaryRow key={item.id} item={item} />
        ))}
      </div>

      {onViewWorkflow ? (
        <button
          type="button"
          onClick={() => {
            onClose();
            onViewWorkflow();
          }}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-medium text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
        >
          <GitBranch className="h-3.5 w-3.5" />
          {frontendMessage("workflow.summary.viewFull")}
        </button>
      ) : null}
    </div>
  );
}

function SummaryRow({ item }: { item: FeedItem }): JSX.Element {
  const Icon = item.kind === "tool" ? Wrench : GitBranch;
  return (
    <div className="flex min-w-0 items-start gap-2 py-2">
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
