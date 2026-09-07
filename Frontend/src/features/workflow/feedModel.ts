import {
  friendlyDecisionKind,
  type RunActivityRecord,
  type RunRecord,
  type TimelineChildRunState,
  type TimelineStep,
  type TimelineStepStatus,
} from "../../store/sessionStore";
import { truncate } from "../../store/session/sessionPresentation";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { activeRunActivityLabel, runActivityLabel, runActivityPresentationPriority } from "./runActivityPresentation";
import {
  isWorkflowLiveActivityVisible,
  projectWorkflowActivities,
  projectWorkflowSteps,
} from "./workflowPresentationProjection";
import { projectToolActivity, projectToolActivityInspection } from "./toolActivityPresentation";
import { projectToolStagePresentation } from "./toolStagePresentation";
import type { ToolStageIconName } from "./toolStageIconContract";

export type FeedItemKind = "activity" | "tool" | "trace";

export interface FeedItem {
  id: string;
  kind: FeedItemKind;
  status: TimelineStepStatus | "neutral";
  title: string;
  subtitle?: string;
  meta?: string;
  step?: TimelineStep;
}

export interface FeedGroup {
  id: string;
  label: string;
  variant?: "activity" | "tools" | "delegation" | "trace";
  meta?: string;
  items: FeedItem[];
  collapsible?: boolean;
  toolIcons?: readonly ToolStageIconName[];
  toolAccessibleLabel?: string;
  /** Present for delegated child runs: the run container plus its internal steps. */
  childRun?: TimelineChildRunState;
  agentName?: string;
  childToolSteps?: TimelineStep[];
}

export interface FeedModel {
  headline: FeedItem;
  groups: FeedGroup[];
  stepCount: number;
  bodyText: string;
  placeholder: string;
  footer?: string;
}

const TimelineStatusPresentation = {
  running: {
    labelKey: "workflow.feed.running",
    dotClass: "bg-accent-solid",
    textClass: "text-accent-content",
  },
  cancelling: {
    labelKey: "workflow.run.status.cancelling",
    dotClass: "bg-accent-content",
    textClass: "text-accent-content",
  },
  pending: {
    labelKey: "workflow.feed.pending",
    dotClass: "bg-ink-300",
    textClass: "text-ink-400",
  },
  failed: {
    labelKey: "workflow.feed.failed",
    dotClass: "bg-brick-500",
    textClass: "text-brick-500",
  },
  done: {
    labelKey: "workflow.feed.done",
    dotClass: "bg-moss-500",
    textClass: "text-moss-600",
  },
  neutral: {
    labelKey: undefined,
    dotClass: "bg-ink-300",
    textClass: "text-ink-400",
  },
} as const satisfies Record<
  TimelineStepStatus | "neutral",
  {
    labelKey?: Parameters<typeof frontendMessage>[0];
    dotClass: string;
    textClass: string;
  }
>;

export function deriveFeedModel(run: RunRecord): FeedModel {
  const steps = projectWorkflowSteps(run);
  const latestStep = steps[steps.length - 1];
  const latestDecision = [...steps].reverse().find((step) => step.kind === "decision");
  const activeStep = resolveActiveStep(
    run,
    latestStep,
    [...steps].reverse().find((step) => isActiveTimelineStatus(step.status)),
    latestDecision,
  );
  const rootSteps = steps.filter(
    (step) => !step.scope?.parentRequestId && !step.scope?.childRunId && !(step.kind === "delegation" && step.childRun),
  );
  const scopedGroups = collectScopedGroups(steps);
  const rootToolGroups = collectRootToolGroups(rootSteps);
  const traceItems = rootSteps
    .filter((step) => step.id !== activeStep?.id)
    .filter((step) => !isToolPrefaceStep(step))
    .filter((step) => !(step.kind === "tool" && step.toolName))
    .filter((step) => !isGroupedToolPlan(step, rootToolGroups.batchIds))
    .slice(-3)
    .map((step) => mapTraceItem(step));
  const groups: FeedGroup[] = [];

  const activityGroup = collectActivityGroup(projectWorkflowActivities(run));
  if (activityGroup) groups.push(activityGroup);
  groups.push(...rootToolGroups.groups);
  groups.push(...scopedGroups);
  if (traceItems.length > 0) {
    groups.push({
      id: "trace",
      label: frontendMessage("workflow.feed.trace"),
      variant: "trace",
      items: traceItems,
    });
  }

  return {
    headline: mapHeadlineItem(run, activeStep, latestDecision),
    groups,
    stepCount: steps.length,
    bodyText: run.visibleKind === "tool_calls" ? "" : run.displayText,
    placeholder: derivePendingLabel(run, activeStep, latestDecision),
    footer: foregroundActivityLabel(run) ? undefined : deriveFooter(activeStep),
  };
}

function collectActivityGroup(activities: readonly RunActivityRecord[]): FeedGroup | undefined {
  const latestStep = activities.at(-1)?.step;
  const currentActivities =
    latestStep === undefined ? activities : activities.filter((activity) => activity.step === latestStep);
  if (currentActivities.length === 0) return undefined;

  const done = currentActivities.filter((activity) => activity.status === "done").length;

  return {
    id: `activity-${latestStep ?? "current"}`,
    label: frontendMessage("workflow.feed.seneraActivity"),
    variant: "activity",
    meta: `${done}/${currentActivities.length}`,
    items: currentActivities.map(mapActivityItem),
    collapsible: true,
  };
}

function mapActivityItem(activity: RunActivityRecord): FeedItem {
  return {
    id: activity.id,
    kind: "activity",
    status: activity.status,
    title: runActivityLabel(activity.activity),
    meta: statusLabel(activity.status),
  };
}

function collectRootToolGroups(rootSteps: TimelineStep[]): {
  groups: FeedGroup[];
  batchIds: Set<string>;
} {
  const groups = new Map<
    string,
    {
      steps: TimelineStep[];
      toolSteps: TimelineStep[];
      firstIndex: number;
    }
  >();

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
  const feedGroups = entries.map(([batchId, group], index) => {
    batchIds.add(batchId);
    const items = group.toolSteps.map((step) => mapToolItem(step));
    const toolGroup = summarizeToolGroup(group.steps, items);
    return {
      id: `tools:${batchId}`,
      label: toolGroup.label || frontendMessage("workflow.feed.toolBatchFallback", { index: index + 1 }),
      variant: "tools" as const,
      meta: toolGroup.meta,
      items,
      collapsible: true,
      toolIcons: toolGroup.icons,
      toolAccessibleLabel: toolGroup.accessibleLabel,
    };
  });

  return { groups: feedGroups, batchIds };
}

function isGroupedToolPlan(step: TimelineStep, groupedBatchIds: ReadonlySet<string>): boolean {
  return step.kind === "tool" && !step.toolName && !!step.toolBatch?.id && groupedBatchIds.has(step.toolBatch.id);
}

function collectScopedGroups(steps: TimelineStep[]): FeedGroup[] {
  const childRuns = new Map<
    string,
    { agentName: string; childRun: TimelineChildRunState; childSteps: TimelineStep[]; firstIndex: number }
  >();
  const orphanItems: FeedItem[] = [];
  let orphanFirstIndex = Number.POSITIVE_INFINITY;
  let orphanWorkflowName: string | undefined;

  // Register containers first because a replay can deliver a child step before
  // the lifecycle snapshot that identifies its child run.
  steps.forEach((step, index) => {
    if (step.kind !== "delegation" || !step.childRun) return;
    const childRunId = step.childRun.id;
    const existing = childRuns.get(childRunId);
    if (existing) {
      existing.childRun = step.childRun;
      existing.agentName = step.scope?.agentName ?? existing.agentName;
      existing.firstIndex = Math.min(existing.firstIndex, index);
      return;
    }
    childRuns.set(childRunId, {
      agentName: step.scope?.agentName ?? "",
      childRun: step.childRun,
      childSteps: [],
      firstIndex: index,
    });
  });

  steps.forEach((step, index) => {
    if (step.kind === "delegation" && step.childRun) return;
    if (!step.scope?.parentRequestId && !step.scope?.childRunId) return;

    const childRunId = step.scope?.childRunId;
    const existing = childRunId ? childRuns.get(childRunId) : undefined;
    if (existing) {
      existing.childSteps.push(step);
      existing.firstIndex = Math.min(existing.firstIndex, index);
      return;
    }

    // Scoped steps that don't resolve to a known child run (e.g. merge steps)
    // keep the legacy flat presentation so they aren't silently dropped.
    orphanItems.push(mapTraceItem(step));
    orphanFirstIndex = Math.min(orphanFirstIndex, index);
    orphanWorkflowName = orphanWorkflowName ?? step.scope?.workflowName;
  });

  const groups: FeedGroup[] = [...childRuns.entries()]
    .sort((a, b) => a[1].firstIndex - b[1].firstIndex)
    .map(([childRunId, entry]) => ({
      id: `delegation:${childRunId}`,
      label: entry.agentName || frontendMessage("workflow.scope.agent"),
      variant: "delegation",
      meta: childRunCardMeta(entry.childRun),
      items: [],
      collapsible: true,
      childRun: entry.childRun,
      agentName: entry.agentName,
      childToolSteps: entry.childSteps,
    }));

  if (orphanItems.length > 0) {
    groups.push({
      id: `scoped-activity:${orphanFirstIndex}`,
      label: frontendMessage("workflow.scope.agent"),
      variant: "delegation",
      meta: scopedGroupMeta(orphanItems, orphanWorkflowName),
      items: orphanItems,
      collapsible: true,
    });
  }

  return groups;
}

function childRunCardMeta(childRun: TimelineChildRunState): string | undefined {
  const toolCalls = childRun.toolCalls;
  if (!toolCalls) return undefined;
  return frontendMessage("workflow.childRun.board.toolCompletion", {
    completed: toolCalls.completed,
    total: toolCalls.started,
  });
}

export interface StageChildRunEntry {
  childRun: TimelineChildRunState;
  agentName?: string;
  childToolSteps: TimelineStep[];
}

export interface StageChildRunSplit {
  childRuns: StageChildRunEntry[];
  rootToolSteps: TimelineStep[];
}

/**
 * Splits a stage's steps into delegated child-run cards and the parent's own tool
 * steps, so stage feeds render child runs as collapsed cards instead of letting
 * their internal tools flood the parent's tool batch.
 */
export function splitStageChildRuns(steps: readonly TimelineStep[]): StageChildRunSplit {
  const childRuns = new Map<string, StageChildRunEntry & { firstIndex: number }>();
  const rootToolSteps: TimelineStep[] = [];

  // Pass 1: collect the delegation containers (they may trail their scoped steps).
  steps.forEach((step, index) => {
    if (step.kind === "delegation" && step.childRun) {
      const existing = childRuns.get(step.childRun.id);
      if (existing) {
        existing.childRun = step.childRun;
        existing.agentName = step.scope?.agentName ?? existing.agentName;
      } else {
        childRuns.set(step.childRun.id, {
          childRun: step.childRun,
          agentName: step.scope?.agentName,
          childToolSteps: [],
          firstIndex: index,
        });
      }
    }
  });

  // Pass 2: route scoped tool steps into their run; the rest belong to the parent.
  steps.forEach((step) => {
    if (step.kind === "delegation") return;
    const childRunId = step.scope?.childRunId;
    if (childRunId) {
      const entry = childRuns.get(childRunId);
      if (entry) {
        if (step.kind === "tool" && step.toolName?.trim()) entry.childToolSteps.push(step);
        return;
      }
    }
    if (step.kind === "tool" && step.toolName?.trim()) rootToolSteps.push(step);
  });

  return {
    childRuns: [...childRuns.entries()]
      .sort((a, b) => a[1].firstIndex - b[1].firstIndex)
      .map(([, entry]) => ({
        childRun: entry.childRun,
        agentName: entry.agentName,
        childToolSteps: entry.childToolSteps,
      })),
    rootToolSteps,
  };
}

function scopedGroupMeta(items: FeedItem[], workflowName?: string): string | undefined {
  const done = items.filter((item) => item.status === "done").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const progress = `${done}/${items.length}`;
  const failedLabel = statusLabel("failed");
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
  if (runningStep?.kind === "tool" || runningStep?.status === "cancelling") return runningStep;
  if (run.visibleKind === "tool_calls" || run.visibleKind === "tool_preface") return latestDecision;
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
  const outputAvailable = run.outputState === "available" || run.outputState === "committed";
  const foregroundActivity = foregroundActivityLabel(run);
  if (foregroundActivity) {
    return {
      id: "live-activity",
      kind: "activity",
      status: "running",
      title: foregroundActivity,
    };
  }

  if (outputAvailable && run.visibleKind === "final_answer") {
    return {
      id: latestDecision?.id ?? "final-answer",
      kind: "trace",
      status: "done",
      title: frontendMessage("workflow.feed.finalAnswer"),
      subtitle: summarizeDecisionSubtitle(latestDecision),
    };
  }

  if (outputAvailable && run.visibleKind === "ask_user") {
    return {
      id: latestDecision?.id ?? "ask-user",
      kind: "trace",
      status: "done",
      title: frontendMessage("workflow.feed.askUser"),
      subtitle: summarizeDecisionSubtitle(latestDecision),
    };
  }

  if (activeStep?.kind === "tool" && activeStep.toolName) {
    return {
      id: activeStep.id,
      kind: "tool",
      status: activeStep.status,
      title: projectToolActivity({
        toolName: activeStep.toolName,
        origin: activeStep.toolOrigin,
        arguments: activeStep.toolArgs,
        status: activeStep.status === "failed" ? "failed" : activeStep.status === "done" ? "completed" : "active",
      }),
      subtitle: summarizeToolSubtitle(activeStep),
      meta: activeStep.callId ? `call ${activeStep.callId.slice(0, 12)}` : undefined,
    };
  }

  if (activeStep?.status === "cancelling") {
    return {
      id: activeStep.id,
      kind: "trace",
      status: "cancelling",
      title: activeStep.title,
      subtitle: summarizeStepSubtitle(activeStep),
    };
  }

  if (run.visibleKind === "tool_calls" || run.visibleKind === "tool_preface") {
    return {
      id: latestDecision?.id ?? "decision-tool-calls",
      kind: "trace",
      status: "done",
      title:
        latestDecision?.decisionKind && !isToolPrefaceStep(latestDecision)
          ? frontendMessage("workflow.feed.action", { kind: friendlyDecisionKind(latestDecision.decisionKind) })
          : frontendMessage("workflow.feed.actionDecision"),
      subtitle: summarizeDecisionSubtitle(latestDecision),
    };
  }

  const liveActivity = liveActivityLabel(run);
  if (outputAvailable && liveActivity) {
    return {
      id: "live-activity",
      kind: "trace",
      status: "running",
      title: liveActivity,
    };
  }

  if (activeStep?.kind === "model") {
    return {
      id: activeStep.id,
      kind: "trace",
      status: activeStep.status,
      title: activeStep.modelName
        ? frontendMessage("workflow.feed.model", { modelName: activeStep.modelName })
        : activeStep.title,
      subtitle: summarizeStepSubtitle(activeStep),
    };
  }

  if (run.visibleKind === "final_answer") {
    return {
      id: latestDecision?.id ?? "final-answer",
      kind: "trace",
      status: outputAvailable ? "done" : "running",
      title: frontendMessage("workflow.feed.finalAnswer"),
      subtitle: summarizeDecisionSubtitle(latestDecision),
    };
  }

  if (run.visibleKind === "ask_user") {
    return {
      id: latestDecision?.id ?? "ask-user",
      kind: "trace",
      status: outputAvailable ? "done" : "running",
      title: frontendMessage("workflow.feed.askUser"),
      subtitle: summarizeDecisionSubtitle(latestDecision),
    };
  }

  if (liveActivity) {
    return {
      id: "live-activity",
      kind: "trace",
      status: "running",
      title: liveActivity,
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
    title: frontendFeatureMessage("workflow.feed.thinking"),
  };
}

function mapToolItem(step: TimelineStep): FeedItem {
  return {
    id: step.id,
    kind: "tool",
    status: step.status,
    // The execution console is an inspection surface. Preserve the runtime identity here;
    // the compact action preview is rendered as the secondary conversation line.
    title: step.toolName ?? step.title,
    subtitle: summarizeToolActivityLabel(step),
    meta: toolItemMeta(step),
    step,
  };
}

function summarizeToolGroup(
  steps: TimelineStep[],
  items: FeedItem[],
): {
  label: string;
  meta: string;
  icons?: readonly ToolStageIconName[];
  accessibleLabel?: string;
} {
  const done = items.filter((item) => item.status === "done").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const settled = done + failed;
  const progress = `${settled}/${items.length}`;
  const plan = [...steps].reverse().find((step) => step.kind === "tool" && !step.toolName && step.toolBatch?.size);
  const size = plan?.toolBatch?.size ?? items.length;
  const mode = plan?.toolBatch?.executionMode;
  const toolSteps = steps.filter((step) => step.kind === "tool" && Boolean(step.toolName));
  const live = items.some(
    (item) => item.status === "running" || item.status === "pending" || item.status === "cancelling",
  );
  const presentation = projectToolStagePresentation({ steps: toolSteps });
  const label = presentation?.title
    ? presentation.title
    : mode === "parallel" && size > 1
      ? frontendMessage("workflow.feed.parallelToolBatch", { count: size })
      : mode === "sequential"
        ? frontendMessage("workflow.feed.sequentialToolCalls", { count: items.length })
        : frontendMessage("workflow.feed.toolCalls", { count: items.length });
  const modeLabel =
    mode === "parallel" && size > 1
      ? frontendMessage("workflow.feed.parallel")
      : mode === "sequential"
        ? frontendMessage("workflow.feed.sequential")
        : undefined;
  return {
    label,
    meta: [modeLabel, live ? progress : undefined].filter(Boolean).join(" · "),
    icons: presentation?.icons,
    accessibleLabel: presentation?.accessibleTitle,
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
    kind: step.kind === "tool" ? "tool" : "trace",
    status: step.status,
    title: step.title,
    subtitle: summarizeStepSubtitle(step),
    meta: childRunItemMeta(step) ?? statusLabel(step.status),
    step,
  };
}

function childRunItemMeta(step: TimelineStep): string | undefined {
  const childRun = step.childRun;
  if (!childRun) return undefined;
  const status =
    childRun.status === "wrapping_up"
      ? frontendMessage("workflow.childRun.status.wrappingUp")
      : childRun.status === "cancelling"
        ? frontendMessage("workflow.run.status.cancelling")
        : statusLabel(step.status);
  const messageCount = childRun.messages?.length;
  const messages = messageCount
    ? frontendMessage("workflow.childRun.messageCount", { count: messageCount })
    : undefined;
  const extension =
    childRun.grantedExtensionMs && childRun.grantedExtensionMs > 0
      ? `+${Math.ceil(childRun.grantedExtensionMs / 60_000)}m`
      : undefined;
  const tools =
    childRun.toolCalls && childRun.toolCalls.started > 0
      ? `${frontendMessage("workflow.summary.tools")} ${childRun.toolCalls.completed}/${childRun.toolCalls.started}`
      : undefined;
  const activeTools =
    childRun.activeTools && childRun.activeTools.length > 0 ? childRun.activeTools.join(", ") : undefined;
  const cancellation = childRunCancellationMeta(childRun.cancellation);
  return [cancellation, activeTools, tools, messages, extension, status].filter(Boolean).join(" · ") || undefined;
}

function childRunCancellationMeta(cancellation: TimelineChildRunState["cancellation"]): string | undefined {
  if (!cancellation) return undefined;
  switch (cancellation.stage) {
    case "completed":
      return frontendMessage("run.cancellation.completed");
    case "failed":
      return frontendMessage("run.cancellation.failed");
    case "settlement_delayed":
      return frontendMessage("run.cancellation.delayed");
    default:
      return frontendMessage("run.cancellation.started");
  }
}

function isToolPrefaceStep(step: TimelineStep): boolean {
  return step.kind === "decision" && step.decisionKind === "tool_preface";
}

function summarizeToolSubtitle(step: TimelineStep): string | undefined {
  if (step.toolErrorMessage) return step.toolErrorMessage;

  if (step.purpose) return truncate(step.purpose, 180);

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

function summarizeToolActivityLabel(step: TimelineStep): string | undefined {
  if (!step.toolName) return undefined;
  const activity = projectToolActivityInspection({
    toolName: step.toolName,
    origin: step.toolOrigin,
    arguments: step.toolArgs,
    status: step.status === "failed" ? "failed" : step.status === "done" ? "completed" : "active",
  });
  return activity.argumentPreview ? activity.label : undefined;
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
  if (isToolPrefaceStep(step)) return undefined;
  if (step.detailJson && typeof step.detailJson === "object") {
    const record = step.detailJson as Record<string, unknown>;
    const toolCalls = record.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      const toolNames = toolCalls
        .map((item) =>
          item && typeof item === "object" ? summarizeUnknown((item as Record<string, unknown>).name) : undefined,
        )
        .filter((value): value is string => !!value);
      if (toolNames.length > 0) {
        return toolNames.join(", ");
      }
    }
  }
  return summarizeStepSubtitle(step);
}

function derivePendingLabel(run: RunRecord, activeStep?: TimelineStep, latestDecision?: TimelineStep): string {
  const outputAvailable = run.outputState === "available" || run.outputState === "committed";
  const foregroundActivity = foregroundActivityLabel(run);
  if (foregroundActivity) return foregroundActivity;
  const liveActivity = liveActivityLabel(run);
  if (activeStep?.kind === "tool" && activeStep.toolName) {
    return projectToolActivity({
      toolName: activeStep.toolName,
      origin: activeStep.toolOrigin,
      arguments: activeStep.toolArgs,
      status: activeStep.status === "failed" ? "failed" : activeStep.status === "done" ? "completed" : "active",
    });
  }

  if (run.visibleKind === "tool_calls" || run.visibleKind === "tool_preface") {
    const tools = summarizeDecisionSubtitle(latestDecision);
    return tools
      ? frontendMessage("workflow.feed.preparingToolsWithNames", { tools })
      : frontendMessage("workflow.feed.preparingTools");
  }

  if (outputAvailable && liveActivity) return liveActivity;

  if (run.visibleKind === "ask_user") {
    return frontendMessage("workflow.feed.preparingQuestion");
  }

  if (run.visibleKind === "final_answer") {
    return frontendMessage("workflow.feed.generatingAnswer");
  }

  if (liveActivity) {
    return frontendMessage("workflow.feed.waitingOutput");
  }

  if (activeStep?.kind === "model") {
    return activeStep.modelName
      ? frontendMessage("workflow.feed.callingModelNamed", { modelName: activeStep.modelName })
      : frontendMessage("workflow.feed.callingModel");
  }

  if (activeStep?.title) {
    return activeStep.status === "running"
      ? frontendMessage("workflow.feed.processingStep", { title: activeStep.title })
      : activeStep.title;
  }

  return run.status === "running"
    ? frontendFeatureMessage("workflow.feed.thinking")
    : frontendMessage("workflow.feed.waitingOutput");
}

function liveActivityLabel(run: RunRecord): string | undefined {
  const activity = run.liveActivity;
  if (!isWorkflowLiveActivityVisible(activity) || !activity) return undefined;
  return activeRunActivityLabel(activity);
}

function foregroundActivityLabel(run: RunRecord): string | undefined {
  if (!run.liveActivity || runActivityPresentationPriority(run.liveActivity) !== "foreground") return undefined;
  return activeRunActivityLabel(run.liveActivity);
}

function summarizeStepSubtitle(step: TimelineStep): string | undefined {
  if (step.toolErrorMessage) return step.toolErrorMessage;
  if (step.errorMessage) return step.errorMessage;
  const latestChildMessage = step.childRun?.messages?.at(-1);
  if (latestChildMessage?.content) return truncate(latestChildMessage.content, 160);
  if (step.retryCode && step.description) return `${step.retryCode} · ${step.description}`;
  if (
    typeof step.promptChars === "number" ||
    typeof step.promptLines === "number" ||
    typeof step.promptTokenCount === "number"
  ) {
    return [
      typeof step.promptChars === "number"
        ? frontendMessage("workflow.node.charCount", { count: step.promptChars })
        : null,
      typeof step.promptLines === "number"
        ? frontendMessage("workflow.node.lineCount", { count: step.promptLines })
        : null,
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
  if (typeof value === "string") return truncate(value, 160);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return truncate(JSON.stringify(value), 180);
  } catch {
    return undefined;
  }
}

export function statusLabel(status: TimelineStepStatus | "neutral"): string | undefined {
  const labelKey = TimelineStatusPresentation[status].labelKey;
  return labelKey ? frontendMessage(labelKey) : undefined;
}

export function statusDotClass(status: TimelineStepStatus | "neutral", _pulse = false): string {
  return TimelineStatusPresentation[status].dotClass;
}

export function statusTextClass(status: TimelineStepStatus | "neutral"): string {
  return TimelineStatusPresentation[status].textClass;
}

function isActiveTimelineStatus(status: TimelineStepStatus): boolean {
  return status === "running" || status === "cancelling";
}
