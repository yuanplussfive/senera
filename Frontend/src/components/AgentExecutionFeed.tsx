import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Loader2,
  Wrench,
} from "lucide-react";
import { cn } from "../lib/util";
import {
  friendlyDecisionKind,
  type RunRecord,
  type TimelineStep,
  type TimelineStepStatus,
} from "../store/sessionStore";

type FeedItemKind = "tool" | "trace";

interface FeedItem {
  id: string;
  kind: FeedItemKind;
  status: TimelineStepStatus | "neutral";
  title: string;
  subtitle?: string;
  meta?: string;
}

interface FeedGroup {
  id: string;
  label: string;
  meta?: string;
  items: FeedItem[];
  defaultExpanded?: boolean;
}

interface FeedModel {
  headline: FeedItem;
  groups: FeedGroup[];
  bodyText: string;
  placeholder: string;
  footer?: string;
}

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
          <div className="flex items-center gap-3 py-2 text-[13px] text-ink-500">
            <LoadingDots />
            <span>{model.placeholder}</span>
          </div>
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

function deriveFeedModel(run: RunRecord): FeedModel {
  const latestStep = run.steps[run.steps.length - 1];
  const latestDecision = [...run.steps].reverse().find((step) => step.kind === "decision");
  const runningStep = [...run.steps].reverse().find((step) => step.status === "running");
  const activeStep = resolveActiveStep(run, latestStep, runningStep, latestDecision);
  const toolItems = run.steps
    .filter((step) => step.kind === "tool" && !!step.toolName)
    .map((step) => mapToolItem(step));
  const traceItems = run.steps
    .filter((step) => step.id !== activeStep?.id)
    .filter((step) => !(step.kind === "tool" && step.toolName))
    .slice(-3)
    .map((step) => mapTraceItem(step));
  const groups: FeedGroup[] = [];

  if (toolItems.length > 0) {
    groups.push({
      id: "tools",
      label: `${toolItems.length} 个工具调用`,
      meta: `${toolItems.filter((item) => item.status === "done").length}/${toolItems.length}`,
      items: toolItems,
      defaultExpanded: true,
    });
  }
  if (traceItems.length > 0) {
    groups.push({
      id: "trace",
      label: "执行轨迹",
      items: traceItems,
    });
  }

  return {
    headline: mapHeadlineItem(run, activeStep, latestDecision),
    groups,
    bodyText: run.visibleText,
    placeholder: "...",
    footer: deriveFooter(activeStep, latestDecision),
  };
}

function resolveActiveStep(
  run: RunRecord,
  latestStep?: TimelineStep,
  runningStep?: TimelineStep,
  latestDecision?: TimelineStep,
): TimelineStep | undefined {
  if (runningStep?.kind === "tool") return runningStep;
  if (run.visibleKind === "tool_calls") return latestDecision;
  if (runningStep?.kind === "model") return runningStep;
  if (run.visibleKind === "final_answer" || run.visibleKind === "ask_user") {
    return latestDecision;
  }
  return latestStep;
}

function mapHeadlineItem(
  run: RunRecord,
  activeStep: TimelineStep | undefined,
  latestDecision: TimelineStep | undefined,
): FeedItem {
  if (activeStep?.kind === "tool" && activeStep.toolName) {
    return {
      id: activeStep.id,
      kind: "tool",
      status: activeStep.status,
      title: `调用 ${activeStep.toolName}`,
      subtitle: summarizeToolSubtitle(activeStep),
      meta: activeStep.callId ? `call ${activeStep.callId.slice(0, 12)}` : undefined,
    };
  }

  if (run.visibleKind === "tool_calls") {
    return {
      id: latestDecision?.id ?? "decision-tool-calls",
      kind: "trace",
      status: "done",
      title: latestDecision?.decisionKind
        ? `行动：${friendlyDecisionKind(latestDecision.decisionKind)}`
        : "行动决策",
      subtitle: summarizeDecisionSubtitle(latestDecision),
    };
  }

  if (activeStep?.kind === "model") {
    return {
      id: activeStep.id,
      kind: "trace",
      status: activeStep.status,
      title: activeStep.modelName ? `模型 ${activeStep.modelName}` : activeStep.title,
      subtitle: summarizeStepSubtitle(activeStep),
    };
  }

  if (run.visibleKind === "final_answer") {
    return {
      id: latestDecision?.id ?? "final-answer",
      kind: "trace",
      status: "running",
      title: "生成回复",
      subtitle: summarizeDecisionSubtitle(latestDecision),
    };
  }

  if (run.visibleKind === "ask_user") {
    return {
      id: latestDecision?.id ?? "ask-user",
      kind: "trace",
      status: "running",
      title: "向用户提问",
      subtitle: summarizeDecisionSubtitle(latestDecision),
    };
  }

  if (activeStep) {
    return {
      id: activeStep.id,
      kind: activeStep.kind === "tool" ? "tool" : "trace",
      status: activeStep.status,
      title: activeStep.title,
      subtitle: summarizeStepSubtitle(activeStep),
    };
  }

  return {
    id: "live",
    kind: "trace",
    status: "running",
    title: "执行中",
  };
}

function mapToolItem(step: TimelineStep): FeedItem {
  return {
    id: step.id,
    kind: "tool",
    status: step.status,
    title: step.toolName ?? step.title,
    subtitle: summarizeToolSubtitle(step),
    meta: statusLabel(step.status),
  };
}

function mapTraceItem(step: TimelineStep): FeedItem {
  return {
    id: step.id,
    kind: "trace",
    status: step.status,
    title: step.title,
    subtitle: summarizeStepSubtitle(step),
    meta: statusLabel(step.status),
  };
}

function summarizeToolSubtitle(step: TimelineStep): string | undefined {
  if (step.toolErrorMessage) return step.toolErrorMessage;

  const preview = summarizeUnknown(step.toolPreview);
  if (preview) return preview;

  const result = summarizeToolResult(step.toolResult);
  if (result) return result;

  const args = summarizeUnknown(step.toolArgs);
  if (args) return args;

  return step.description;
}

function summarizeToolResult(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return summarizeUnknown(value);
  const record = value as Record<string, unknown>;
  const preview = summarizeUnknown(record.preview);
  if (preview) return preview;
  const content = summarizeUnknown(record.content);
  if (content) return content;
  return summarizeUnknown(value);
}

function summarizeDecisionSubtitle(step?: TimelineStep): string | undefined {
  if (!step) return undefined;
  if (step.detailJson && typeof step.detailJson === "object") {
    const record = step.detailJson as Record<string, unknown>;
    const toolCalls = record.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      const toolNames = toolCalls
        .map((item) => (item && typeof item === "object" ? summarizeUnknown((item as Record<string, unknown>).name) : undefined))
        .filter((value): value is string => !!value);
      if (toolNames.length > 0) {
        return toolNames.join(", ");
      }
    }
  }
  return summarizeStepSubtitle(step);
}

function summarizeStepSubtitle(step: TimelineStep): string | undefined {
  if (step.toolErrorMessage) return step.toolErrorMessage;
  if (step.errorMessage) return step.errorMessage;
  if (step.retryCode && step.description) return `${step.retryCode} · ${step.description}`;
  if (typeof step.promptChars === "number" || typeof step.promptLines === "number") {
    return [typeof step.promptChars === "number" ? `${step.promptChars} chars` : null, typeof step.promptLines === "number" ? `${step.promptLines} lines` : null]
      .filter(Boolean)
      .join(" · ");
  }
  if (step.decisionKind) {
    return friendlyDecisionKind(step.decisionKind);
  }
  return step.description;
}

function deriveFooter(activeStep?: TimelineStep, latestDecision?: TimelineStep): string | undefined {
  if (activeStep?.callId) return `callId · ${activeStep.callId}`;
  if (latestDecision?.xmlRoot) return `xml · ${latestDecision.xmlRoot}`;
  return undefined;
}

function summarizeUnknown(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return clampInline(value, 160);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return clampInline(JSON.stringify(value), 180);
  } catch {
    return undefined;
  }
}

function clampInline(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function statusLabel(status: TimelineStepStatus | "neutral"): string | undefined {
  switch (status) {
    case "running":
      return "进行中";
    case "failed":
      return "失败";
    case "done":
      return "完成";
    default:
      return undefined;
  }
}

function statusDotClass(status: TimelineStepStatus | "neutral", pulse = false): string {
  const base =
    status === "running"
      ? "bg-terra-500"
      : status === "failed"
      ? "bg-brick-500"
      : status === "done"
      ? "bg-moss-500"
      : "bg-ink-300";
  return pulse && status === "running" ? `${base} animate-pulse` : base;
}

function statusTextClass(status: TimelineStepStatus | "neutral"): string {
  switch (status) {
    case "running":
      return "text-terra-600";
    case "failed":
      return "text-brick-500";
    case "done":
      return "text-moss-600";
    default:
      return "text-ink-400";
  }
}

function LoadingDots(): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <Loader2
          key={i}
          className="h-3 w-3 animate-spin text-ink-400"
          style={{ animationDelay: `${i * 140}ms`, animationDuration: "1.1s" }}
        />
      ))}
    </span>
  );
}
