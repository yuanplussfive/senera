import {
  frontendFeatureMessage,
  isFrontendFeatureMessageKey,
  type FrontendFeatureMessageKey,
} from "../../i18n/frontendFeatureMessageCatalog";
import type { TimelineStep, TimelineStepKind, TimelineStepStatus } from "../../store/sessionStore";
import RawToolStagePresentationMap from "./toolStagePresentation.map.json";
import {
  projectToolActivity,
  projectToolActivityInspection,
  projectToolBatchAction,
  type ToolActivityStatus,
} from "./toolActivityPresentation";
import { isToolStageIconName, type ToolStageIconName } from "./toolStageIconContract";

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

interface ToolStageLabels {
  active: FrontendFeatureMessageKey;
  completed: FrontendFeatureMessageKey;
}

interface ToolStageCategoryRule {
  id: string;
  icon: ToolStageIconName;
  match: {
    exactToolNames?: string[];
    toolNamePrefixes?: string[];
    stepKinds?: TimelineStepKind[];
  };
  labels: ToolStageLabels;
}

interface ToolStageActivityGroupRule {
  id: string;
  icon: ToolStageIconName;
  title: FrontendFeatureMessageKey;
  activityCategories: string[];
}

interface ToolStagePresentationMap {
  version: 4;
  defaultCategory: string;
  defaultActivityGroup: string;
  maxVisibleBatchIcons: number;
  originIcons: {
    mcp: ToolStageIconName;
  };
  activityGroups: ToolStageActivityGroupRule[];
  singleToolLabels: ToolStageLabels;
  categories: ToolStageCategoryRule[];
}

const ToolStagePresentationMap = parseToolStagePresentationMap(RawToolStagePresentationMap);
const FailedToolStageLabel: FrontendFeatureMessageKey = "workflow.stage.tools.failed";

export function projectToolStagePresentation(run: {
  readonly steps: readonly TimelineStep[];
}): ToolStagePresentation | undefined {
  const executionSteps = run.steps.filter(isStageExecutionStep);
  if (executionSteps.length === 0) return undefined;

  const semanticSteps = executionSteps.filter(
    (step) => step.kind === "delegation" || (step.kind === "tool" && Boolean(step.toolName)),
  );
  const statusSteps = semanticSteps.length > 0 ? semanticSteps : executionSteps;
  const singleToolStep =
    semanticSteps.length === 1 && semanticSteps[0]?.kind === "tool" && semanticSteps[0].toolName
      ? semanticSteps[0]
      : undefined;
  const categoryIds = new Set(
    (semanticSteps.length > 0 ? semanticSteps : executionSteps).map((step) => resolveCategory(step).id),
  );
  const category = singleToolStep
    ? resolveCategory(singleToolStep)
    : categoryIds.size === 1
      ? readCategory([...categoryIds][0]!)
      : readCategory(ToolStagePresentationMap.defaultCategory);
  const status = summarizeStageStatus(statusSteps);
  const counts = summarizeStageCounts(semanticSteps);
  const activities = projectStageActivities(semanticSteps.length > 0 ? semanticSteps : executionSteps);
  const labels = singleToolStep ? ToolStagePresentationMap.singleToolLabels : category.labels;
  const labelKey = status === "failed" ? FailedToolStageLabel : status === "done" ? labels.completed : labels.active;
  const fallbackTitle = frontendFeatureMessage(labelKey, { toolName: singleToolStep?.toolName ?? "" });
  const title = activities.map((activity) => activity.title).join(" · ") || fallbackTitle;
  const summary = activities.length === 1 ? activities[0]?.summary : undefined;
  const accessibleTitle = activities.map((activity) => activity.accessibleTitle).join(" · ") || title;
  const stageIcons = uniqueIcons(activities.flatMap((activity) => activity.icons));
  const batchKind =
    activities.length > 1 || activities.some((activity) => activity.actions.length > 1) ? "mixed" : "uniform";
  return {
    category: category.id,
    icon: stageIcons[0] ?? category.icon,
    icons: stageIcons,
    mode: singleToolStep ? "single-tool" : "semantic-batch",
    batchKind,
    status,
    title,
    accessibleTitle,
    summary,
    activities,
    counts: counts.total > 1 ? counts : undefined,
  };
}

function projectStageActivities(steps: readonly TimelineStep[]): ToolStageActivityPresentation[] {
  const grouped = new Map<string, { rule: ToolStageActivityGroupRule; steps: TimelineStep[] }>();
  for (const step of steps) {
    const activityCategory = resolveToolActivityCategory(step);
    const rule = resolveActivityGroup(activityCategory);
    const group = grouped.get(rule.id) ?? { rule, steps: [] };
    group.steps.push(step);
    grouped.set(rule.id, group);
  }
  return [...grouped.values()].map(({ rule, steps: groupSteps }) => projectStageActivity(rule, groupSteps));
}

function projectStageActivity(
  rule: ToolStageActivityGroupRule,
  steps: readonly TimelineStep[],
): ToolStageActivityPresentation {
  const status = summarizeStageStatus(steps);
  const counts = summarizeStageCounts(steps);
  const actionGroups = new Map<string, { count: number; representative: TimelineStep & { toolName: string } }>();
  for (const step of steps) {
    if (!step.toolName) continue;
    const category = resolveToolActivityCategory(step);
    const current = actionGroups.get(category);
    actionGroups.set(category, {
      count: (current?.count ?? 0) + 1,
      representative: current?.representative ?? (step as TimelineStep & { toolName: string }),
    });
  }
  const actions = [...actionGroups.entries()].map(([id, group]) => ({
    id,
    icon: resolveStepIcon(group.representative),
    label: projectToolBatchAction({
      toolName: group.representative.toolName,
      origin: group.representative.toolOrigin,
      arguments: group.representative.toolArgs,
      status: readToolActivityStatus(group.representative.status),
    }).label,
    count: group.count,
  }));
  const singleToolStep =
    steps.length === 1 && steps[0]?.kind === "tool" && steps[0].toolName
      ? (steps[0] as TimelineStep & { toolName: string })
      : undefined;
  const configuredTitle = frontendFeatureMessage(rule.title);
  const sharedIntent = summarizeStageIntent(steps);
  const title = singleToolStep
    ? (projectToolActivity({
        toolName: singleToolStep.toolName,
        origin: singleToolStep.toolOrigin,
        arguments: singleToolStep.toolArgs,
        status: readToolActivityStatus(status),
      }) ?? configuredTitle)
    : rule.id === ToolStagePresentationMap.defaultActivityGroup && sharedIntent
      ? sharedIntent
      : configuredTitle;
  const summary = actions.length > 0 && !singleToolStep ? actions.map((action) => action.label).join(" · ") : undefined;
  const incomplete = counts.failed
    ? frontendFeatureMessage("workflow.stage.activityGroup.incomplete", { count: counts.failed })
    : undefined;
  const bounds = readStageBounds(steps, status);
  return {
    id: rule.id,
    title,
    accessibleTitle: [title, summary, incomplete].filter(Boolean).join(" · "),
    icons: uniqueIcons(
      actions.map((action) => action.icon),
      rule.icon,
    ),
    status,
    actions,
    summary,
    counts,
    ...bounds,
  };
}

function resolveToolActivityCategory(step: TimelineStep): string {
  if (!step.toolName) return resolveCategory(step).id;
  return projectToolActivityInspection({
    toolName: step.toolName,
    origin: step.toolOrigin,
    arguments: step.toolArgs,
    status: readToolActivityStatus(step.status),
  }).category;
}

function resolveActivityGroup(activityCategory: string): ToolStageActivityGroupRule {
  return (
    ToolStagePresentationMap.activityGroups.find((group) => group.activityCategories.includes(activityCategory)) ??
    readActivityGroup(ToolStagePresentationMap.defaultActivityGroup)
  );
}

function readActivityGroup(id: string): ToolStageActivityGroupRule {
  const group = ToolStagePresentationMap.activityGroups.find((candidate) => candidate.id === id);
  if (!group) throw new Error(`Unknown tool stage activity group: ${id}`);
  return group;
}

function resolveStepIcon(step: TimelineStep): ToolStageIconName {
  return step.kind === "tool" && step.toolOrigin?.kind === "mcp"
    ? ToolStagePresentationMap.originIcons.mcp
    : resolveCategory(step).icon;
}

function uniqueIcons(icons: readonly ToolStageIconName[], fallback?: ToolStageIconName): ToolStageIconName[] {
  const unique = [...new Set(icons)];
  if (unique.length === 0 && fallback) unique.push(fallback);
  return unique.slice(0, ToolStagePresentationMap.maxVisibleBatchIcons);
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

function summarizeStageIntent(steps: readonly TimelineStep[]): string | undefined {
  const intents = [
    ...new Set(steps.map((step) => compactIntent(step.purpose)).filter((value): value is string => Boolean(value))),
  ];
  return intents.length === 1 ? intents[0] : undefined;
}

function compactIntent(value: string | undefined): string | undefined {
  const normalized = value
    ?.replace(/```[\s\S]*?```/gu, " ")
    .replace(/[`*_#>]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return undefined;
  const sentenceEnd = normalized.search(/[。！？!?](?:\s|$)/u);
  const concise = sentenceEnd >= 0 ? normalized.slice(0, sentenceEnd + 1) : normalized;
  return concise.length > 120 ? `${concise.slice(0, 117)}...` : concise;
}

function readToolActivityStatus(status: ToolStageStatus): ToolActivityStatus {
  if (status === "done") return "completed";
  if (status === "failed") return "failed";
  return "active";
}

function resolveCategory(step: TimelineStep): ToolStageCategoryRule {
  const exactMatch = ToolStagePresentationMap.categories.find((category) =>
    category.match.exactToolNames?.includes(step.toolName ?? ""),
  );
  if (exactMatch) return exactMatch;

  const kindMatch = ToolStagePresentationMap.categories.find((category) =>
    category.match.stepKinds?.includes(step.kind),
  );
  if (kindMatch) return kindMatch;

  const prefixMatches = ToolStagePresentationMap.categories
    .flatMap((category) =>
      (category.match.toolNamePrefixes ?? [])
        .filter((prefix) => step.toolName?.startsWith(prefix))
        .map((prefix) => ({ category, prefix })),
    )
    .sort((left, right) => right.prefix.length - left.prefix.length);
  return prefixMatches[0]?.category ?? readCategory(ToolStagePresentationMap.defaultCategory);
}

function summarizeStageStatus(steps: readonly TimelineStep[]): ToolStageStatus {
  if (steps.some((step) => step.status === "cancelling")) return "cancelling";
  if (steps.some((step) => step.status === "running")) return "running";
  if (steps.some((step) => step.status === "pending")) return "pending";
  if (steps.length > 0 && steps.every((step) => step.status === "failed")) return "failed";
  if (steps.some((step) => step.status === "done")) return "done";
  if (steps.every((step) => step.status === "done")) return "done";
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
  return {
    total: steps.length,
    settled: completed + failed,
    completed,
    failed,
  };
}

function isStageExecutionStep(step: TimelineStep): boolean {
  return step.kind === "tool" || step.kind === "delegation" || step.kind === "retry" || step.kind === "error";
}

function readCategory(id: string): ToolStageCategoryRule {
  const category = ToolStagePresentationMap.categories.find((candidate) => candidate.id === id);
  if (!category) throw new Error(`Unknown tool stage presentation category: ${id}`);
  return category;
}

function parseToolStagePresentationMap(value: unknown): ToolStagePresentationMap {
  if (!value || typeof value !== "object") throw new Error("Tool stage presentation map must be an object.");
  const record = value as Record<string, unknown>;
  if (
    record.version !== 4 ||
    typeof record.defaultCategory !== "string" ||
    typeof record.defaultActivityGroup !== "string" ||
    typeof record.maxVisibleBatchIcons !== "number" ||
    !Number.isInteger(record.maxVisibleBatchIcons) ||
    record.maxVisibleBatchIcons < 1 ||
    !isRecord(record.originIcons) ||
    !isToolStageIconName(record.originIcons.mcp) ||
    !Array.isArray(record.activityGroups) ||
    !Array.isArray(record.categories)
  ) {
    throw new Error("Tool stage presentation map has an unsupported structure.");
  }
  const categories = record.categories.map(parseCategoryRule);
  const activityGroups = record.activityGroups.map(parseActivityGroupRule);
  const singleToolLabels = parseLabels(record.singleToolLabels, "single-tool template");
  if (!categories.some((category) => category.id === record.defaultCategory)) {
    throw new Error(`Unknown default tool stage category: ${record.defaultCategory}`);
  }
  if (!activityGroups.some((group) => group.id === record.defaultActivityGroup)) {
    throw new Error(`Unknown default tool stage activity group: ${record.defaultActivityGroup}`);
  }
  return {
    version: 4,
    defaultCategory: record.defaultCategory,
    defaultActivityGroup: record.defaultActivityGroup,
    maxVisibleBatchIcons: record.maxVisibleBatchIcons,
    originIcons: { mcp: record.originIcons.mcp },
    activityGroups,
    singleToolLabels,
    categories,
  };
}

function parseActivityGroupRule(value: unknown): ToolStageActivityGroupRule {
  if (!isRecord(value)) throw new Error("Tool stage activity group must be an object.");
  const activityCategories = readStringArray(value.activityCategories);
  if (
    typeof value.id !== "string" ||
    !isToolStageIconName(value.icon) ||
    !isFrontendFeatureMessageKey(value.title) ||
    !activityCategories?.length
  ) {
    throw new Error("Tool stage activity group is missing its identity, title, icon, or categories.");
  }
  return {
    id: value.id,
    icon: value.icon,
    title: value.title,
    activityCategories,
  };
}

function parseCategoryRule(value: unknown): ToolStageCategoryRule {
  if (!value || typeof value !== "object") throw new Error("Tool stage category must be an object.");
  const record = value as Record<string, unknown>;
  const labels = record.labels as Record<string, unknown> | undefined;
  const match = (record.match as Record<string, unknown> | undefined) ?? {};
  if (typeof record.id !== "string" || !isToolStageIconName(record.icon) || !labels) {
    throw new Error("Tool stage category is missing its identity or labels.");
  }
  return {
    id: record.id,
    icon: record.icon,
    match: {
      exactToolNames: readStringArray(match.exactToolNames),
      toolNamePrefixes: readStringArray(match.toolNamePrefixes),
      stepKinds: readTimelineStepKinds(match.stepKinds),
    },
    labels: parseLabels(labels, `category '${record.id}'`),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLabels(value: unknown, source: string): ToolStageLabels {
  if (!value || typeof value !== "object") {
    throw new Error(`Tool stage ${source} is missing its labels.`);
  }
  const labels = value as Record<string, unknown>;
  if (!isFrontendFeatureMessageKey(labels.active) || !isFrontendFeatureMessageKey(labels.completed)) {
    throw new Error(`Tool stage ${source} references an unknown message key.`);
  }
  return { active: labels.active, completed: labels.completed };
}

function readStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Tool stage match values must be string arrays.");
  }
  return value;
}

function readTimelineStepKinds(value: unknown): TimelineStepKind[] | undefined {
  const values = readStringArray(value);
  if (!values) return undefined;
  const allowed = new Set<TimelineStepKind>([
    "understand",
    "prompt",
    "model",
    "decision",
    "delegation",
    "tool",
    "retry",
    "answer",
    "error",
  ]);
  if (values.some((item) => !allowed.has(item as TimelineStepKind))) {
    throw new Error("Tool stage stepKinds contains an unknown timeline step kind.");
  }
  return values as TimelineStepKind[];
}
