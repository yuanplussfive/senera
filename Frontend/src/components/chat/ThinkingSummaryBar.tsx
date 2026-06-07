import { useState } from "react";
import { ChevronDown, GitBranch, Lightbulb, Wrench } from "lucide-react";
import { cn } from "../../lib/util";
import type { RunRecord } from "../../store/sessionStore";
import { summarizeRun } from "../workflow/runSummary";
import {
  deriveFeedModel,
  statusDotClass,
  statusTextClass,
  type FeedItem,
} from "../workflow/feedModel";

/**
 * 已完成的助手消息气泡里的「工作流摘要」折叠条。
 * 折叠态显示步数/工具数/耗时；展开态复用 deriveFeedModel 的分组渲染。
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
  const statusLabel =
    run.status === "failed" ? "失败" : run.status === "cancelled" ? "已取消" : "已完成";

  return (
    <div className="mt-1.5 overflow-hidden rounded-xl border border-ink-200/60 bg-paper-50/70">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-paper-100/70"
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

      {expanded ? (
        <SummaryDetail run={run} onViewWorkflow={onViewWorkflow} />
      ) : null}
    </div>
  );
}

function SummaryDetail({
  run,
  onViewWorkflow,
}: {
  run: RunRecord;
  onViewWorkflow?: () => void;
}): JSX.Element {
  const model = deriveFeedModel(run);
  const toolGroup = model.groups.find((group) => group.id === "tools");
  const traceGroups = model.groups.filter((group) => group.id !== "tools");

  return (
    <div className="border-t border-ink-200/50 px-3 py-2.5">
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
          onClick={onViewWorkflow}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900"
        >
          <GitBranch className="h-3.5 w-3.5" />
          查看完整工作流
        </button>
      ) : null}
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
