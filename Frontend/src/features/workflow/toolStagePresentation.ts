import { resolveFrontendLocalizedText } from "../../i18n/frontendLocaleModel";
import type { TimelineStep, TimelineStepStatus } from "../../store/sessionStore";
import type { AgentToolPresentation } from "../../../../Source/AgentSystem/Types/AgentToolPresentationTypes";
import {
  projectToolActivity,
  projectToolActivityInspection,
  readToolPresentation,
  type ToolActivityStatus,
} from "./toolActivityPresentation";
import type { ToolStageIconName } from "./toolStageIconContract";

export type ToolStageStatus = TimelineStepStatus | "neutral";

export interface ToolStageActionPresentation {
  id: string;
  icon: ToolStageIconName;
  label: string;
  count: number;
}

export interface ToolStageActivityPresentation {
  id: string;
  title: string;
  accessibleTitle: string;
  icons: readonly ToolStageIconName[];
  status: ToolStageStatus;
  actions: readonly ToolStageActionPresentation[];
  summary?: string;
  counts: {
    total: number;
    settled: number;
    completed: number;
    failed: number;
  };
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
}

export interface ToolStagePresentation {
  category: string;
  icon: ToolStageIconName;
  icons: readonly ToolStageIconName[];
  mode: "single-tool" | "semantic-batch";
  batchKind?: "uniform" | "mixed";
  status: ToolStageStatus;
  title: string;
  accessibleTitle: string;
  summary?: string;
  activities: readonly ToolStageActivityPresentation[];
  counts?: {
    total: number;
    settled: number;
    completed: number;
    failed: number;
  };
}

interface PresentationGroup {
  readonly id: string;
  readonly title: string;
  readonly icon: ToolStageIconName;
}

const GenericSystemGroup: PresentationGroup = { id: "tools", title: "Tools", icon: "tools" };
const McpGroup: PresentationGroup = { id: "mcp", title: "MCP", icon: "globe" };
const DelegationGroup: PresentationGroup = { id: "delegation", title: "Delegate", icon: "users" };
const MaximumVisibleBatchIcons = 3;

/**
 * Projects already-resolved tool presentation metadata into the workflow UI.
 * The frontend intentionally does not recognize extension IDs, capabilities,
 * or tool names: newly installed System packages remain correctly presented
 * as soon as their manifest declares a domain and presentation contract.
 */
export function projectToolStagePresentation(run: {
  readonly steps: readonly TimelineStep[];
}): ToolStagePresentation | undefined {
  const executionSteps = run.steps.filter(isStageExecutionStep);
  if (executionSteps.length === 0) return undefined;

  const semanticSteps = executionSteps.filter(
    (step) => step.kind === "delegation" || (step.kind === "tool" && Boolean(step.toolName)),
  );
  const visibleSteps = semanticSteps.length > 0 ? semanticSteps : executionSteps;
  const singleToolStep =
    visibleSteps.length === 1 && visibleSteps[0]?.kind === "tool" && visibleSteps[0].toolName
      ? visibleSteps[0]
      : undefined;
  const activities = projectStageActivities(visibleSteps);
  const status = summarizeStageStatus(visibleSteps);
  const counts = summarizeStageCounts(visibleSteps);
  const groups = uniquePresentationGroups(visibleSteps);
  const stageIcons = uniqueIcons(activities.flatMap((activity) => activity.icons));
  const title = singleToolStep
    ? projectToolActivity({
        toolName: singleToolStep.toolName!,
        origin: singleToolStep.toolOrigin,
        arguments: singleToolStep.toolArgs,
        status: readToolActivityStatus(singleToolStep.status),
      })
    : activities.map((activity) => activity.title).join(" · ") || GenericSystemGroup.title;
  const summary = activities.length === 1 ? activities[0]?.summary : undefined;
  // A batch represents a declared presentation group, not whichever Tool
  // happened to arrive first. Single-tool stages retain their fine-grained
  // category for consumers that need it.
  const category = singleToolStep
    ? resolveStepCategory(singleToolStep)
    : groups.length === 1
      ? groups[0]!.id
      : GenericSystemGroup.id;
  return {
    category,
    icon: stageIcons[0] ?? groups[0]?.icon ?? GenericSystemGroup.icon,
    icons: stageIcons,
    mode: singleToolStep ? "single-tool" : "semantic-batch",
    batchKind:
      activities.length > 1 || activities.some((activity) => activity.actions.length > 1) ? "mixed" : "uniform",
    status,
    title,
    accessibleTitle: [title, summary].filter(Boolean).join(" · "),
    summary,
    activities,
    counts: counts.total > 1 ? counts : undefined,
  };
}

function projectStageActivities(steps: readonly TimelineStep[]): ToolStageActivityPresentation[] {
  const grouped = new Map<string, { group: PresentationGroup; steps: TimelineStep[] }>();
  for (const step of steps) {
    const group = resolveStepGroup(step);
    const entry = grouped.get(group.id) ?? { group, steps: [] };
    entry.steps.push(step);
    grouped.set(group.id, entry);
  }
  return [...grouped.values()].map(({ group, steps: groupSteps }) => projectStageActivity(group, groupSteps));
}

function projectStageActivity(group: PresentationGroup, steps: readonly TimelineStep[]): ToolStageActivityPresentation {
  const status = summarizeStageStatus(steps);
  const counts = summarizeStageCounts(steps);
  const actionGroups = new Map<string, { count: number; representative: TimelineStep & { toolName: string } }>();
  for (const step of steps) {
    if (!step.toolName) continue;
    const category = resolveStepCategory(step);
    const entry = actionGroups.get(category);
    actionGroups.set(category, {
      count: (entry?.count ?? 0) + 1,
      representative: entry?.representative ?? (step as TimelineStep & { toolName: string }),
    });
  }
  const actions = [...actionGroups.entries()].map(([id, action]) => ({
    id,
    icon: resolveStepIcon(action.representative),
    label: projectToolActivity({
      toolName: action.representative.toolName,
      origin: action.representative.toolOrigin,
      arguments: action.representative.toolArgs,
      status: readToolActivityStatus(action.representative.status),
    }),
    count: action.count,
  }));
  const singleToolStep =
    steps.length === 1 && steps[0]?.kind === "tool" && steps[0].toolName
      ? (steps[0] as TimelineStep & { toolName: string })
      : undefined;
  const title = singleToolStep
    ? projectToolActivity({
        toolName: singleToolStep.toolName,
        origin: singleToolStep.toolOrigin,
        arguments: singleToolStep.toolArgs,
        status: readToolActivityStatus(status),
      })
    : group.title;
  const summary = actions.length > 0 && !singleToolStep ? actions.map((action) => action.label).join(" · ") : undefined;
  const incomplete = counts.failed > 0 ? `${counts.failed} incomplete` : undefined;
  const bounds = readStageBounds(steps, status);
  return {
    id: group.id,
    title,
    accessibleTitle: [title, summary, incomplete].filter(Boolean).join(" · "),
    icons: uniqueIcons(
      actions.map((action) => action.icon),
      group.icon,
    ),
    status,
    actions,
    summary,
    counts,
    ...bounds,
  };
}

function uniquePresentationGroups(steps: readonly TimelineStep[]): PresentationGroup[] {
  const groups = new Map<string, PresentationGroup>();
  for (const step of steps) {
    const group = resolveStepGroup(step);
    if (!groups.has(group.id)) groups.set(group.id, group);
  }
  return [...groups.values()];
}

function resolveStepGroup(step: TimelineStep): PresentationGroup {
  const presentation = step.toolName ? readToolPresentation({ origin: step.toolOrigin }) : undefined;
  return presentation ? presentationGroup(presentation) : fallbackGroup(step);
}

function presentationGroup(presentation: AgentToolPresentation): PresentationGroup {
  return {
    id: presentation.group.id,
    title: resolveFrontendLocalizedText(presentation.group.title),
    icon: presentation.icon,
  };
}

function fallbackGroup(step: TimelineStep): PresentationGroup {
  if (step.kind === "delegation") return DelegationGroup;
  return step.toolOrigin?.kind === "mcp" ? McpGroup : GenericSystemGroup;
}

function resolveStepCategory(step: TimelineStep): string {
  if (!step.toolName) return resolveStepGroup(step).id;
  return projectToolActivityInspection({
    toolName: step.toolName,
    origin: step.toolOrigin,
    arguments: step.toolArgs,
    status: readToolActivityStatus(step.status),
  }).category;
}

function resolveStepIcon(step: TimelineStep): ToolStageIconName {
  const presentation = step.toolName ? readToolPresentation({ origin: step.toolOrigin }) : undefined;
  return presentation?.icon ?? fallbackGroup(step).icon;
}

function uniqueIcons(icons: readonly ToolStageIconName[], fallback?: ToolStageIconName): ToolStageIconName[] {
  const unique = [...new Set(icons)];
  if (unique.length === 0 && fallback) unique.push(fallback);
  return unique.slice(0, MaximumVisibleBatchIcons);
}

function readStageBounds(
  steps: readonly TimelineStep[],
  status: ToolStageStatus,
): Pick<ToolStageActivityPresentation, "startedAt" | "endedAt" | "durationMs"> {
  const startedAt = readDateBoundary(
    steps.map((step) => step.startedAt),
    "first",
  );
  const endedAt = isLiveStageStatus(status)
    ? undefined
    : readDateBoundary(
        steps.map((step) => step.endedAt).filter((value): value is string => Boolean(value)),
        "last",
      );
  const start = startedAt ? Date.parse(startedAt) : Number.NaN;
  const end = endedAt ? Date.parse(endedAt) : Number.NaN;
  return {
    startedAt,
    endedAt,
    durationMs: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : undefined,
  };
}

function readDateBoundary(values: readonly string[], edge: "first" | "last"): string | undefined {
  const sorted = values
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((left, right) => left.time - right.time);
  return edge === "first" ? sorted[0]?.value : sorted.at(-1)?.value;
}

function isLiveStageStatus(status: ToolStageStatus): boolean {
  return status === "running" || status === "cancelling" || status === "pending";
}

function readToolActivityStatus(status: ToolStageStatus): ToolActivityStatus {
  if (status === "done") return "completed";
  if (status === "failed") return "failed";
  return "active";
}

function summarizeStageStatus(steps: readonly TimelineStep[]): ToolStageStatus {
  if (steps.some((step) => step.status === "cancelling")) return "cancelling";
  if (steps.some((step) => step.status === "running")) return "running";
  if (steps.some((step) => step.status === "pending")) return "pending";
  if (steps.length > 0 && steps.every((step) => step.status === "failed")) return "failed";
  if (steps.some((step) => step.status === "done")) return "done";
  return "neutral";
}

function summarizeStageCounts(steps: readonly TimelineStep[]): {
  total: number;
  settled: number;
  completed: number;
  failed: number;
} {
  const completed = steps.filter((step) => step.status === "done").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  return { total: steps.length, settled: completed + failed, completed, failed };
}

function isStageExecutionStep(step: TimelineStep): boolean {
  return step.kind === "tool" || step.kind === "delegation" || step.kind === "retry" || step.kind === "error";
}
