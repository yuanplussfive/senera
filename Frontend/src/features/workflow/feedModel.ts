import {
  friendlyDecisionKind,
  type RunRecord,
  type TimelineStep,
  type TimelineStepStatus,
} from "../../store/sessionStore";
import { truncate } from "../../store/session/sessionPresentation";

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
  variant?: "tools" | "delegation" | "trace";
  meta?: string;
  items: FeedItem[];
  defaultExpanded?: boolean;
  collapsible?: boolean;
}

export interface FeedModel {
  headline: FeedItem;
  groups: FeedGroup[];
  bodyText: string;
  placeholder: string;
  footer?: string;
}

const TimelineStatusPresentation = {
  running: {
    label: "进行中",
    dotClass: "bg-umber-500 motion-safe:animate-pulse",
    textClass: "text-umber-600",
  },
  pending: {
    label: "等待中",
    dotClass: "bg-ink-300",
    textClass: "text-ink-400",
  },
  failed: {
    label: "失败",
    dotClass: "bg-brick-500",
    textClass: "text-brick-500",
  },
  done: {
    label: "完成",
    dotClass: "bg-moss-500",
    textClass: "text-moss-600",
  },
  neutral: {
    label: undefined,
    dotClass: "bg-ink-300",
    textClass: "text-ink-400",
  },
} as const satisfies Record<TimelineStepStatus | "neutral", {
  label?: string;
  dotClass: string;
  textClass: string;
}>;

export function deriveFeedModel(run: RunRecord): FeedModel {
  const latestStep = run.steps[run.steps.length - 1];
  const latestDecision = [...run.steps].reverse().find((step) => step.kind === "decision");
  const runningStep = [...run.steps].reverse().find((step) => step.status === "running");
  const activeStep = resolveActiveStep(run, latestStep, runningStep, latestDecision);
  const rootSteps = run.steps.filter((step) => !step.scope?.parentRequestId);
  const scopedGroups = collectScopedGroups(run.steps);
  const rootToolGroups = collectRootToolGroups(rootSteps);
  const traceItems = rootSteps
    .filter((step) => step.id !== activeStep?.id)
    .filter((step) => !(step.kind === "tool" && step.toolName))
    .filter((step) => !isGroupedToolPlan(step, rootToolGroups.batchIds))
    .slice(-3)
    .map((step) => mapTraceItem(step));
  const groups: FeedGroup[] = [];

  groups.push(...rootToolGroups.groups);
  groups.push(...scopedGroups);
  if (traceItems.length > 0) {
    groups.push({
      id: "trace",
      label: "执行轨迹",
      variant: "trace",
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

function collectRootToolGroups(rootSteps: TimelineStep[]): {
  groups: FeedGroup[];
  batchIds: Set<string>;
} {
  const groups = new Map<string, {
    steps: TimelineStep[];
    toolSteps: TimelineStep[];
    firstIndex: number;
  }>();

  rootSteps.forEach((step, index) => {
    if (step.kind !== "tool") return;
    const batchId = step.toolBatch?.id ?? (step.toolName ? step.id : undefined);
    if (!batchId) return;
    const group = groups.get(batchId) ?? {
      steps: [],
      toolSteps: [],
      firstIndex: index,
    };
    group.steps.push(step);
    if (step.toolName) {
      group.toolSteps.push(step);
    }
    group.firstIndex = Math.min(group.firstIndex, index);
    groups.set(batchId, group);
  });

  const batchIds = new Set<string>();
  const entries = [...groups.entries()]
    .filter(([, group]) => group.toolSteps.length > 0)
    .sort((a, b) => a[1].firstIndex - b[1].firstIndex);
  const feedGroups = entries
    .map(([batchId, group], index) => {
      batchIds.add(batchId);
      const items = group.toolSteps.map((step) => mapToolItem(step));
      const toolGroup = summarizeToolGroup(group.steps, items);
      return {
        id: `tools:${batchId}`,
        label: toolGroup.label || `工具批次 ${index + 1}`,
        variant: "tools" as const,
        meta: toolGroup.meta,
        items,
        defaultExpanded: items.some((item) => item.status === "running" || item.status === "failed")
          || index === entries.length - 1,
        collapsible: true,
      };
    });

  return { groups: feedGroups, batchIds };
}

function isGroupedToolPlan(step: TimelineStep, groupedBatchIds: ReadonlySet<string>): boolean {
  return step.kind === "tool"
    && !step.toolName
    && !!step.toolBatch?.id
    && groupedBatchIds.has(step.toolBatch.id);
}

function collectScopedGroups(steps: TimelineStep[]): FeedGroup[] {
  const groups = new Map<string, { label: string; workflowName?: string; items: FeedItem[]; firstIndex: number }>();
  steps.forEach((step, index) => {
    if (!step.scope?.parentRequestId) return;
    const key = scopedGroupKey(step);
    const existing = groups.get(key);
    const group = existing ?? {
      label: scopedGroupLabel(step),
      workflowName: step.scope.workflowName,
      items: [],
      firstIndex: index,
    };
    group.items.push(mapTraceItem(step));
    groups.set(key, group);
  });

  return [...groups.entries()]
    .sort((a, b) => a[1].firstIndex - b[1].firstIndex)
    .map(([id, group]) => ({
      id,
      label: group.label,
      variant: "delegation",
      meta: scopedGroupMeta(group.items, group.workflowName),
      items: group.items,
      defaultExpanded: group.items.some((item) => item.status === "running" || item.status === "failed"),
      collapsible: true,
    }));
}

function scopedGroupKey(step: TimelineStep): string {
  return [
    "delegation",
    step.scope?.workflowName,
    step.scope?.role,
    step.scope?.jobId,
    step.scope?.agentName,
  ]
    .filter((value) => value !== undefined && value !== "")
    .join(":");
}

function scopedGroupLabel(step: TimelineStep): string {
  if (step.scope?.role === "merge") return "结果合并";
  return step.scope?.agentName ? `子代理 · ${step.scope.agentName}` : "子代理";
}

function scopedGroupMeta(items: FeedItem[], workflowName?: string): string | undefined {
  const done = items.filter((item) => item.status === "done").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const progress = `${done}/${items.length}`;
  const failedLabel = TimelineStatusPresentation.failed.label;
  if (failed > 0) {
    return [workflowName, progress, `${failed} ${failedLabel}`].filter(Boolean).join(" · ");
  }
  return workflowName ? `${workflowName} · ${progress}` : progress;
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
    meta: toolItemMeta(step),
  };
}

function summarizeToolGroup(
  steps: TimelineStep[],
  items: FeedItem[],
): { label: string; meta: string } {
  const done = items.filter((item) => item.status === "done").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const progress = `${done}/${items.length}`;
  const plan = [...steps]
    .reverse()
    .find((step) => step.kind === "tool" && !step.toolName && step.toolBatch?.size);
  const size = plan?.toolBatch?.size ?? items.length;
  const mode = plan?.toolBatch?.executionMode;
  const label = mode === "parallel" && size > 1
    ? `并发工具批次 · ${size} 个工具`
    : mode === "sequential"
      ? `${items.length} 个顺序工具调用`
      : `${items.length} 个工具调用`;
  const modeLabel = mode === "parallel" && size > 1
    ? "并发"
    : mode === "sequential"
      ? "顺序"
      : undefined;
  const failedLabel = failed > 0 ? `${failed} 失败` : undefined;
  return {
    label,
    meta: [modeLabel, progress, failedLabel].filter(Boolean).join(" · "),
  };
}

function toolItemMeta(step: TimelineStep): string | undefined {
  const status = statusLabel(step.status);
  const index = typeof step.toolBatch?.index === "number" ? `#${step.toolBatch.index + 1}` : undefined;
  return [index, status].filter(Boolean).join(" · ");
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

  const presentation = step.toolPresentation;
  if (presentation?.summary) return truncate(presentation.summary, 160);
  if (presentation?.headline) return presentation.headline;

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

  if (activeStep?.kind === "pi") {
    return activeStep.eventType ? `Pi 正在处理：${activeStep.eventType}` : "Pi 正在处理";
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
  if (step.kind === "pi") {
    return [step.traceSource, step.eventType, step.description]
      .filter((value): value is string => Boolean(value))
      .join(" · ");
  }
  return step.description;
}

function deriveFooter(activeStep?: TimelineStep): string | undefined {
  if (activeStep?.callId) return `call ${activeStep.callId.slice(0, 12)}`;
  return undefined;
}

function summarizeUnknown(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return truncate(value, 160);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return truncate(JSON.stringify(value), 180);
  } catch {
    return undefined;
  }
}

export function statusLabel(status: TimelineStepStatus | "neutral"): string | undefined {
  return TimelineStatusPresentation[status].label;
}

export function statusDotClass(status: TimelineStepStatus | "neutral", _pulse = false): string {
  return TimelineStatusPresentation[status].dotClass;
}

export function statusTextClass(status: TimelineStepStatus | "neutral"): string {
  return TimelineStatusPresentation[status].textClass;
}
