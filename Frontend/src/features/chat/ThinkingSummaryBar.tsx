import { useState } from "react";
import { ChevronDown, GitBranch, Lightbulb, Wrench } from "lucide-react";
import { cn } from "../../lib/util";
import type { RunRecord } from "../../store/sessionStore";
import { summarizeRun } from "../workflow/runSummary";
import { readRunStatusLabel } from "../workflow/stepPresentation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../shared/ui";
import {
  deriveFeedModel,
  statusDotClass,
  statusTextClass,
  type FeedItem,
} from "../workflow/feedModel";

/**
 * 已完成的助手消息气泡里的「工作流摘要」。
 * 消息流里只保留固定摘要条；详情通过 portal 浮层展示，避免展开时顶动回复正文。
 * 仅在 run 已结束（status !== "running"）时显示，避免与流式 feed 并存。
 */
export function ThinkingSummaryBar({
  run,
  onViewWorkflow,
}: {
  run?: RunRecord;
  onViewWorkflow?: () => void;
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);

  if (!run || run.status === "running") return null;
  if (run.steps.length === 0) return null;

  const summary = summarizeRun(run);
  const statusLabel = readRunStatusLabel(run.status);

  return (
    <DropdownMenu open={expanded} onOpenChange={setExpanded} modal={false}>
      <div className="mt-1.5 rounded-xl border border-ink-200/60 bg-paper-50/70">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-paper-100/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-terra-200/70"
            aria-expanded={expanded}
          >
            <Lightbulb className="h-3.5 w-3.5 shrink-0 text-terra-500" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] tracking-wide text-ink-500">
              {summary.total} 步
              {summary.tools > 0 ? ` · ${summary.tools} 工具` : ""}
              {summary.duration ? ` · ${summary.duration}` : ""}
              {summary.failed > 0 ? (
                <span className="text-brick-500"> · {summary.failed} 失败</span>
              ) : null}
              {` · ${statusLabel}`}
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-ink-400 transition",
                expanded && "rotate-180",
              )}
            />
          </button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="w-[min(680px,calc(100vw-32px))] max-h-[min(520px,calc(100vh-96px))] overflow-y-auto rounded-xl p-0 shadow-soft"
      >
        <SummaryDetail
          run={run}
          onViewWorkflow={onViewWorkflow}
          onClose={() => setExpanded(false)}
        />
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
  const toolGroup = model.groups.find((group) => group.id === "tools");
  const traceGroups = model.groups.filter((group) => group.id !== "tools");

  return (
    <div className="bg-paper-50">
      <div className="flex items-center gap-2 border-b border-ink-200/60 px-3 py-2.5">
        <Lightbulb className="h-3.5 w-3.5 shrink-0 text-terra-500" />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-ink-850">思考过程</div>
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-400">
            {run.steps.length} 步 · {readRunStatusLabel(run.status)}
          </div>
        </div>
      </div>
      <div className="px-3 py-2.5">
        <div className="flex flex-col gap-1.5">
          {toolGroup ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-[12px] text-ink-700">
                <Wrench className="h-3.5 w-3.5 shrink-0 text-ink-500" />
                <span className="min-w-0 flex-1">{toolGroup.label}</span>
                {toolGroup.meta ? (
                  <span className="font-mono text-[10.5px] text-ink-400">{toolGroup.meta}</span>
                ) : null}
              </div>
              <div className="ml-3 flex flex-col gap-1 border-l border-ink-200/60 pl-3">
                {toolGroup.items.map((item) => (
                  <SummaryRow key={item.id} item={item} />
                ))}
              </div>
            </div>
          ) : null}
          {traceGroups.map((group) => (
            <div key={group.id} className="flex flex-col gap-1">
              {group.items.map((item) => (
                <SummaryRow key={item.id} item={item} />
              ))}
            </div>
          ))}
        </div>

        {onViewWorkflow ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              onViewWorkflow();
            }}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
          >
            <GitBranch className="h-3.5 w-3.5" />
            查看完整工作流
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SummaryRow({ item }: { item: FeedItem }): JSX.Element {
  return (
    <div className="flex min-w-0 items-start gap-2">
      {item.kind === "tool" ? (
        <span className={cn("mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(item.status))} />
      ) : (
        <GitBranch className="mt-[1px] h-3.5 w-3.5 shrink-0 text-ink-400" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-ink-800">{item.title}</div>
        {item.subtitle ? (
          <div className="mt-0.5 truncate text-[11.5px] text-ink-500">{item.subtitle}</div>
        ) : null}
      </div>
      {item.meta ? (
        <span className={cn("shrink-0 pt-px text-[11px]", statusTextClass(item.status))}>{item.meta}</span>
      ) : null}
    </div>
  );
}
