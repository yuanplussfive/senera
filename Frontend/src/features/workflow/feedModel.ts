import {
  friendlyDecisionKind,
  type RunRecord,
  type TimelineStep,
  type TimelineStepStatus,
} from "../../store/sessionStore";

export type FeedItemKind = "tool" | "trace";

export interface FeedItem {
  id: string;
  kind: FeedItemKind;
  status: TimelineStepStatus | "neutral";
  title: string;
  subtitle?: string;
  meta?: string;
}

export interface FeedGroup {
  id: string;
  label: string;
  meta?: string;
  items: FeedItem[];
  defaultExpanded?: boolean;
}

export interface FeedModel {
  headline: FeedItem;
  groups: FeedGroup[];
  bodyText: string;
  placeholder: string;
  footer?: string;
}

export function deriveFeedModel(run: RunRecord): FeedModel {
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
    bodyText: run.displayText,
    placeholder: derivePendingLabel(run, activeStep, latestDecision),
    footer: deriveFooter(activeStep),
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

function derivePendingLabel(
  run: RunRecord,
  activeStep?: TimelineStep,
  latestDecision?: TimelineStep,
): string {
  if (activeStep?.kind === "tool" && activeStep.toolName) {
    return activeStep.status === "running"
      ? `正在执行 ${activeStep.toolName}`
      : `准备执行 ${activeStep.toolName}`;
  }

  if (run.visibleKind === "tool_calls") {
    const tools = summarizeDecisionSubtitle(latestDecision);
    return tools ? `正在准备工具调用：${tools}` : "正在准备工具调用";
  }

  if (run.visibleKind === "ask_user") {
    return "正在整理需要确认的问题";
  }

  if (run.visibleKind === "final_answer") {
    return "正在生成回复";
  }

  if (activeStep?.kind === "model") {
    return activeStep.modelName ? `正在调用 ${activeStep.modelName}` : "正在调用模型";
  }

  if (activeStep?.title) {
    return activeStep.status === "running" ? `正在处理：${activeStep.title}` : activeStep.title;
  }

  return run.status === "running" ? "正在执行下一步" : "等待输出";
}

function summarizeStepSubtitle(step: TimelineStep): string | undefined {
  if (step.toolErrorMessage) return step.toolErrorMessage;
  if (step.errorMessage) return step.errorMessage;
  if (step.retryCode && step.description) return `${step.retryCode} · ${step.description}`;
  if (
    typeof step.promptChars === "number"
    || typeof step.promptLines === "number"
    || typeof step.promptTokenCount === "number"
  ) {
    return [
      typeof step.promptChars === "number" ? `${step.promptChars} 字` : null,
      typeof step.promptLines === "number" ? `${step.promptLines} 行` : null,
      typeof step.promptTokenCount === "number" ? `${step.promptTokenCount} token` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (step.decisionKind) {
    return friendlyDecisionKind(step.decisionKind);
  }
  return step.description;
}

function deriveFooter(activeStep?: TimelineStep): string | undefined {
  if (activeStep?.callId) return `call ${activeStep.callId.slice(0, 12)}`;
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

export function statusLabel(status: TimelineStepStatus | "neutral"): string | undefined {
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

export function statusDotClass(status: TimelineStepStatus | "neutral", _pulse = false): string {
  const base =
    status === "running"
      ? "bg-umber-500 motion-safe:animate-pulse"
      : status === "failed"
      ? "bg-brick-500"
      : status === "done"
      ? "bg-moss-500"
      : "bg-ink-300";
  return base;
}

export function statusTextClass(status: TimelineStepStatus | "neutral"): string {
  switch (status) {
    case "running":
      return "text-umber-600";
    case "failed":
      return "text-brick-500";
    case "done":
      return "text-moss-600";
    default:
      return "text-ink-400";
  }
}
