import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Wrench,
} from "lucide-react";
import { cn } from "../lib/util";
import { type RunRecord } from "../store/sessionStore";
import {
  deriveFeedModel,
  statusDotClass,
  statusTextClass,
  type FeedGroup,
  type FeedItem,
} from "./workflow/feedModel";

export function AgentExecutionFeed({ run }: { run: RunRecord }): JSX.Element {
  const model = useMemo(() => deriveFeedModel(run), [run]);
  const toolGroup = model.groups.find((group) => group.id === "tools");
  const traceGroups = model.groups.filter((group) => group.id !== "tools");
  const [toolsExpanded, setToolsExpanded] = useState(toolGroup?.defaultExpanded ?? true);

  useEffect(() => {
    setToolsExpanded(toolGroup?.defaultExpanded ?? true);
  }, [run.requestId, toolGroup?.items.length, toolGroup?.defaultExpanded]);

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <FeedHeadline item={model.headline} stepCount={run.steps.length} />
      <div className="relative ml-1 pl-5 before:absolute before:left-[5px] before:top-1 before:bottom-0 before:w-px before:bg-ink-200/70">
        {toolGroup ? (
          <ToolGroup
            group={toolGroup}
            expanded={toolsExpanded}
            onToggle={() => setToolsExpanded((value) => !value)}
          />
        ) : null}
        {traceGroups.map((group) => (
          <div key={group.id} className="mt-1 flex flex-col gap-1">
            {group.items.map((item) => (
              <FeedRow key={item.id} item={item} />
            ))}
          </div>
        ))}
        {model.bodyText ? (
          <div className="pt-2 text-[14.5px] leading-[1.72] text-ink-800">
            <span className="whitespace-pre-wrap break-words">{model.bodyText}</span>
            <span className="caret-blink" />
          </div>
        ) : (
          <PendingLine label={model.placeholder} />
        )}
        {model.footer ? (
          <div className="pt-1.5 font-mono text-[10.5px] text-ink-400">{model.footer}</div>
        ) : null}
      </div>
    </div>
  );
}

function FeedHeadline({
  item,
  stepCount,
}: {
  item: FeedItem;
  stepCount: number;
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className={cn("mt-[7px] inline-block h-2 w-2 shrink-0 rounded-full", statusDotClass(item.status, true))} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-medium text-ink-900">{item.title}</span>
          <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-400">
            {stepCount} steps
          </span>
          {item.meta ? (
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-400">
              {item.meta}
            </span>
          ) : null}
        </div>
        {item.subtitle ? (
          <div className="mt-0.5 text-[12px] leading-relaxed text-ink-500">{item.subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}

function ToolGroup({
  group,
  expanded,
  onToggle,
}: {
  group: FeedGroup;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-paper-100/80"
      >
        <Wrench className="h-3.5 w-3.5 shrink-0 text-ink-500" />
        <span className="min-w-0 flex-1 text-[12.75px] text-ink-900">{group.label}</span>
        {group.meta ? <span className="font-mono text-[10.5px] text-ink-400">{group.meta}</span> : null}
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-400" />
        )}
      </button>
      {expanded ? (
        <div className="ml-3 flex flex-col gap-1 border-l border-ink-200/60 pl-3">
          {group.items.map((item) => (
            <FeedRow key={item.id} item={item} compact />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FeedRow({ item, compact = false }: { item: FeedItem; compact?: boolean }): JSX.Element {
  return (
    <div className={cn("flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5", compact && "py-1")}>
      {item.kind === "tool" ? (
        <span className={cn("mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full", statusDotClass(item.status))} />
      ) : (
        <GitBranch className="mt-[1px] h-3.5 w-3.5 shrink-0 text-ink-400" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.75px] text-ink-900">{item.title}</div>
        {item.subtitle ? (
          <div className="mt-0.5 truncate text-[11.5px] text-ink-500">{item.subtitle}</div>
        ) : null}
      </div>
      {item.meta ? (
        <span className={cn("shrink-0 pt-px text-[11.5px]", statusTextClass(item.status))}>{item.meta}</span>
      ) : null}
    </div>
  );
}

function PendingLine({ label }: { label: string }): JSX.Element {
  return (
    <div
      className="my-1.5 inline-flex max-w-full items-center gap-2 rounded-lg bg-paper-100/70 px-2.5 py-1.5 text-[12.75px] text-ink-500"
      role="status"
      aria-live="polite"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center" aria-hidden="true">
        <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-terra-400/35" />
        <span className="h-1.5 w-1.5 rounded-full bg-terra-500" />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}
