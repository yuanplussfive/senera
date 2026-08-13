import {
  BookOpen,
  BookOpenText,
  Brain,
  CalendarClock,
  Clock3,
  FileSearch,
  FileText,
  FolderSearch,
  GitBranch,
  Image,
  MessageCircle,
  MonitorCog,
  Pencil,
  Search,
  Terminal,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  frontendMessage,
  isFrontendMessageKey,
  type FrontendMessageKey,
} from "../../i18n/frontendMessageCatalog";
import type { TimelineStep, TimelineStepKind, TimelineStepStatus } from "../../store/sessionStore";
import RawToolStagePresentationMap from "./toolStagePresentation.map.json";
import { projectToolActivity, projectToolBatchSummary, type ToolActivityStatus } from "./toolActivityPresentation";

export type ToolStageStatus = TimelineStepStatus | "neutral";

export interface ToolStagePresentation {
  category: string;
  icon: LucideIcon;
  mode: "single-tool" | "semantic-batch";
  status: ToolStageStatus;
  title: string;
  summary?: string;
  counts?: {
    total: number;
    completed: number;
    failed: number;
  };
}

interface ToolStageLabels {
  active: FrontendMessageKey;
  completed: FrontendMessageKey;
}

interface ToolStageCategoryRule {
  id: string;
  icon: keyof typeof ToolStageIconCatalog;
  match: {
    exactToolNames?: string[];
    toolNamePrefixes?: string[];
    stepKinds?: TimelineStepKind[];
  };
  labels: ToolStageLabels;
}

interface ToolStagePresentationMap {
  version: number;
  defaultCategory: string;
  singleToolLabels: ToolStageLabels;
  categories: ToolStageCategoryRule[];
}

const ToolStageIconCatalog = {
  "book-open": BookOpen,
  "book-search": BookOpenText,
  brain: Brain,
  "calendar-clock": CalendarClock,
  clock: Clock3,
  "file-search": FileSearch,
  "file-text": FileText,
  "folder-search": FolderSearch,
  "git-branch": GitBranch,
  image: Image,
  "message-circle": MessageCircle,
  "monitor-cog": MonitorCog,
  pencil: Pencil,
  search: Search,
  terminal: Terminal,
  workflow: Workflow,
  wrench: Wrench,
} as const satisfies Record<string, LucideIcon>;

const ToolStagePresentationMap = parseToolStagePresentationMap(RawToolStagePresentationMap);
const FailedToolStageLabel: FrontendMessageKey = "workflow.stage.tools.failed";

export function projectToolStagePresentation(run: { readonly steps: readonly TimelineStep[] }): ToolStagePresentation | undefined {
  const executionSteps = run.steps.filter(isStageExecutionStep);
  if (executionSteps.length === 0) return undefined;

  const semanticSteps = executionSteps.filter(
    (step) => step.kind === "delegation" || (step.kind === "tool" && Boolean(step.toolName)),
  );
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
  const status = summarizeStageStatus(executionSteps);
  const counts = summarizeStageCounts(semanticSteps);
  const labels = singleToolStep ? ToolStagePresentationMap.singleToolLabels : category.labels;
  const labelKey = status === "failed" ? FailedToolStageLabel : status === "done" ? labels.completed : labels.active;
  const activityTitle = singleToolStep
    ? projectToolActivity({
        toolName: singleToolStep.toolName!,
        origin: singleToolStep.toolOrigin,
        arguments: singleToolStep.toolArgs,
        status: readToolActivityStatus(status),
      })
    : undefined;
  const batchTitle = !singleToolStep ? projectToolBatchTitle(semanticSteps, status, counts) : undefined;
  const actionSummary =
    singleToolStep
      ? activityTitle ?? frontendMessage(labelKey, { toolName: singleToolStep.toolName })
      : batchTitle ?? frontendMessage(labelKey);
  const intent = summarizeStageIntent(semanticSteps);

  return {
    category: category.id,
    icon: ToolStageIconCatalog[category.icon],
    mode: singleToolStep ? "single-tool" : "semantic-batch",
    status,
    title: intent ?? actionSummary,
    summary: intent ? actionSummary : undefined,
    counts: counts.total > 1 ? counts : undefined,
  };
}

function summarizeStageIntent(steps: readonly TimelineStep[]): string | undefined {
  const intents = [...new Set(
    steps
      .map((step) => compactIntent(step.purpose))
      .filter((value): value is string => Boolean(value)),
  )];
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

function projectToolBatchTitle(
  steps: readonly TimelineStep[],
  status: ToolStageStatus,
  counts: { readonly total: number; readonly completed: number; readonly failed: number },
): string | undefined {
  const toolSteps = steps.filter((step): step is TimelineStep & { toolName: string } => step.kind === "tool" && Boolean(step.toolName));
  if (toolSteps.length === 0) return undefined;
  const actionStatus = status === "running" || status === "cancelling" || status === "pending" ? "active" : "completed";
  return projectToolBatchSummary(toolSteps, actionStatus, counts);
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
  if (steps.some((step) => step.status === "failed")) return "failed";
  if (steps.every((step) => step.status === "done")) return "done";
  return "neutral";
}

function summarizeStageCounts(steps: readonly TimelineStep[]): {
  total: number;
  completed: number;
  failed: number;
} {
  return {
    total: steps.length,
    completed: steps.filter((step) => step.status === "done").length,
    failed: steps.filter((step) => step.status === "failed").length,
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
    record.version !== 1 ||
    typeof record.defaultCategory !== "string" ||
    !Array.isArray(record.categories)
  ) {
    throw new Error("Tool stage presentation map has an unsupported structure.");
  }
  const categories = record.categories.map(parseCategoryRule);
  const singleToolLabels = parseLabels(record.singleToolLabels, "single-tool template");
  if (!categories.some((category) => category.id === record.defaultCategory)) {
    throw new Error(`Unknown default tool stage category: ${record.defaultCategory}`);
  }
  return { version: 1, defaultCategory: record.defaultCategory, singleToolLabels, categories };
}

function parseCategoryRule(value: unknown): ToolStageCategoryRule {
  if (!value || typeof value !== "object") throw new Error("Tool stage category must be an object.");
  const record = value as Record<string, unknown>;
  const labels = record.labels as Record<string, unknown> | undefined;
  const match = (record.match as Record<string, unknown> | undefined) ?? {};
  if (typeof record.id !== "string" || !isToolStageIcon(record.icon) || !labels) {
    throw new Error("Tool stage category is missing its identity, icon, or labels.");
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

function parseLabels(value: unknown, source: string): ToolStageLabels {
  if (!value || typeof value !== "object") {
    throw new Error(`Tool stage ${source} is missing its labels.`);
  }
  const labels = value as Record<string, unknown>;
  if (!isFrontendMessageKey(labels.active) || !isFrontendMessageKey(labels.completed)) {
    throw new Error(`Tool stage ${source} references an unknown message key.`);
  }
  return { active: labels.active, completed: labels.completed };
}

function isToolStageIcon(value: unknown): value is keyof typeof ToolStageIconCatalog {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ToolStageIconCatalog, value);
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
