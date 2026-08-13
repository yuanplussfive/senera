import {
  frontendMessage,
  isFrontendMessageKey,
  type FrontendMessageKey,
} from "../../i18n/frontendMessageCatalog";
import type { ToolEventOrigin } from "../../api/eventTypes";
import RawToolActivityMap from "./toolActivityPresentation.map.json";

export type ToolActivityStatus = "active" | "completed" | "failed";

export interface ToolActivityInput {
  readonly toolName: string;
  readonly origin?: ToolEventOrigin;
  readonly arguments?: unknown;
  readonly status: ToolActivityStatus;
}

interface ToolActivityLabels {
  readonly active: FrontendMessageKey;
  readonly completed: FrontendMessageKey;
  readonly failed: FrontendMessageKey;
}

interface ToolActivityBatchLabels {
  readonly active: FrontendMessageKey;
  readonly completed: FrontendMessageKey;
}

interface ToolActivityRule extends ToolActivityLabels {
  readonly id: string;
  readonly exactCapabilities?: readonly string[];
  readonly capabilityPrefixes?: readonly string[];
  readonly exactToolNames?: readonly string[];
  readonly toolNamePrefixes?: readonly string[];
  readonly argumentPath?: string;
  readonly detailPaths?: readonly string[];
  readonly batchLabels: ToolActivityBatchLabels;
}

interface ToolActivityMap {
  readonly version: 1;
  readonly batchSummaryMaxActions: number;
  readonly default: ToolActivityLabels & { readonly batchLabels: ToolActivityBatchLabels };
  readonly mcp: ToolActivityLabels & { readonly batchLabels: ToolActivityBatchLabels };
  readonly rules: readonly ToolActivityRule[];
}

const ToolActivityMap = parseToolActivityMap(RawToolActivityMap);

export function projectToolActivity(input: ToolActivityInput): string {
  return projectToolActivityInspection(input).label;
}

export interface ToolActivityInspection {
  readonly label: string;
  readonly category: string;
  readonly subjects: readonly string[];
}

export function projectToolActivityInspection(input: ToolActivityInput): ToolActivityInspection {
  const rule = resolveRule(input.toolName, input.origin?.capability);
  const labels: ToolActivityLabels = input.origin?.kind === "mcp" ? ToolActivityMap.mcp : rule ?? ToolActivityMap.default;
  const command = rule?.argumentPath ? readStringAtPath(input.arguments, rule.argumentPath) : undefined;
  const toolName = displayToolName(input.toolName, input.origin);
  const batchFallback = rule?.argumentPath && !command && input.status !== "failed"
    ? projectToolBatchSummary(
        [{ toolName: input.toolName, origin: input.origin }],
        input.status === "active" ? "active" : "completed",
      )
    : undefined;
  return {
    label:
      batchFallback ??
      frontendMessage(labels[input.status], {
        toolName,
        command: command ? compactPreview(command) : toolName,
      }),
    category: input.origin?.kind === "mcp" ? "mcp" : rule?.id ?? "system",
    subjects: uniqueStrings((rule?.detailPaths ?? []).flatMap((path) => readStringsAtPath(input.arguments, path))),
  };
}

export function projectToolBatchAction(
  input: Pick<ToolActivityInput, "toolName" | "origin"> & { readonly count: number; readonly status: "active" | "completed" },
): { readonly category: string; readonly label: string } {
  const rule = resolveRule(input.toolName, input.origin?.capability);
  const presentation = input.origin?.kind === "mcp" ? ToolActivityMap.mcp : rule ?? ToolActivityMap.default;
  return {
    category: input.origin?.kind === "mcp" ? "mcp" : rule?.id ?? "system",
    label: frontendMessage(presentation.batchLabels[input.status], {
      count: input.count,
      toolName: displayToolName(input.toolName, input.origin),
    }),
  };
}

export function projectToolBatchActions(
  inputs: readonly Pick<ToolActivityInput, "toolName" | "origin">[],
  status: "active" | "completed",
): string[] {
  const grouped = new Map<string, { count: number; input: Pick<ToolActivityInput, "toolName" | "origin"> }>();
  for (const input of inputs) {
    const action = projectToolBatchAction({ ...input, count: 1, status });
    const existing = grouped.get(action.category);
    grouped.set(action.category, { count: (existing?.count ?? 0) + 1, input: existing?.input ?? input });
  }
  return [...grouped.values()].map(({ count, input }) =>
    projectToolBatchAction({ ...input, count, status }).label,
  );
}

export function projectToolBatchSummary(
  inputs: readonly Pick<ToolActivityInput, "toolName" | "origin">[],
  status: "active" | "completed",
  counts?: { readonly completed: number; readonly failed: number },
): string | undefined {
  const actions = projectToolBatchActions(inputs, status);
  if (actions.length === 0) return undefined;
  const visibleActions = actions.slice(0, ToolActivityMap.batchSummaryMaxActions);
  const hiddenActionCount = actions.length - visibleActions.length;
  const visibleActionSummary = visibleActions.join(" · ");
  const actionSummary = hiddenActionCount > 0
    ? frontendMessage("workflow.stage.actions.withRemainder", {
        actions: visibleActionSummary,
        count: hiddenActionCount,
      })
    : visibleActionSummary;
  const key = status === "active"
    ? counts?.failed
      ? "workflow.stage.actions.progress"
      : "workflow.stage.actions.active"
    : counts?.failed
      ? "workflow.stage.actions.result"
      : "workflow.stage.actions.completed";
  return frontendMessage(key, {
    actions: actionSummary,
    completed: counts?.completed ?? 0,
    failed: counts?.failed ?? 0,
  });
}

function resolveRule(toolName: string, capability: string | undefined): ToolActivityRule | undefined {
  return ToolActivityMap.rules
    .map((rule) => ({ rule, score: matchScore(rule, toolName, capability) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.rule;
}

function matchScore(rule: ToolActivityRule, toolName: string, capability: string | undefined): number {
  return Math.max(
    ...(capability
      ? rule.exactCapabilities?.filter((value) => value === capability).map((value) => 4_000 + value.length) ?? []
      : []),
    ...(capability
      ? rule.capabilityPrefixes?.filter((value) => capability.startsWith(value)).map((value) => 3_000 + value.length) ?? []
      : []),
    ...(rule.exactToolNames?.filter((value) => value === toolName).map((value) => 2_000 + value.length) ?? []),
    ...(rule.toolNamePrefixes?.filter((value) => toolName.startsWith(value)).map((value) => 1_000 + value.length) ?? []),
    0,
  );
}

function displayToolName(toolName: string, origin: ToolEventOrigin | undefined): string {
  if (origin?.kind !== "mcp") return toolName;
  const tool = origin.tool?.trim() || toolName;
  const server = origin.server?.trim();
  return server ? `${server} · ${tool}` : tool;
}

function readStringAtPath(value: unknown, path: string): string | undefined {
  return readStringsAtPath(value, path)[0];
}

function readStringsAtPath(value: unknown, path: string): string[] {
  const segments = path.split(".");
  const visit = (current: unknown, index: number): string[] => {
    if (index >= segments.length) {
      return typeof current === "string" && current.trim() ? [current.trim()] : [];
    }
    const segment = segments[index];
    if (segment === "*") {
      return Array.isArray(current) ? current.flatMap((entry) => visit(entry, index + 1)) : [];
    }
    return isRecord(current) ? visit(current[segment], index + 1) : [];
  };
  return visit(value, 0);
}

function compactPreview(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function parseToolActivityMap(value: unknown): ToolActivityMap {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.batchSummaryMaxActions !== "number" ||
    !Number.isInteger(value.batchSummaryMaxActions) ||
    value.batchSummaryMaxActions < 1 ||
    !isRecord(value.default) ||
    !isRecord(value.origins)
  ) {
    throw new Error("Tool activity presentation map has an unsupported structure.");
  }
  const defaultPresentation = parsePresentation(value.default, "default");
  const mcp = parsePresentation(value.origins.mcp, "MCP origin");
  const rules = Array.isArray(value.capabilityRules) ? value.capabilityRules.map(parseRule) : [];
  return {
    version: 1,
    batchSummaryMaxActions: value.batchSummaryMaxActions,
    default: defaultPresentation,
    mcp,
    rules,
  };
}

function parseRule(value: unknown): ToolActivityRule {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.match)) {
    throw new Error("Tool activity rule is missing its identity or match.");
  }
  const exactCapabilities = readStringArray(value.match.exactCapabilities);
  const capabilityPrefixes = readStringArray(value.match.capabilityPrefixes);
  const exactToolNames = readStringArray(value.match.exactToolNames);
  const toolNamePrefixes = readStringArray(value.match.toolNamePrefixes);
  if (!exactCapabilities && !capabilityPrefixes && !exactToolNames && !toolNamePrefixes) {
    throw new Error(`Tool activity rule '${value.id}' has no match.`);
  }
  return {
    id: value.id,
    exactCapabilities,
    capabilityPrefixes,
    exactToolNames,
    toolNamePrefixes,
    argumentPath: typeof value.argumentPath === "string" ? value.argumentPath : undefined,
    detailPaths: readStringArray(value.detailPaths),
    ...parsePresentation(value, `rule '${value.id}'`),
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => compactPreview(value)).filter(Boolean))];
}

function parseLabels(value: unknown, source: string): ToolActivityLabels {
  if (!isRecord(value) || !isFrontendMessageKey(value.active) || !isFrontendMessageKey(value.completed) || !isFrontendMessageKey(value.failed)) {
    throw new Error(`Tool activity ${source} has invalid message keys.`);
  }
  return { active: value.active, completed: value.completed, failed: value.failed };
}

function parsePresentation(
  value: unknown,
  source: string,
): ToolActivityLabels & { readonly batchLabels: ToolActivityBatchLabels } {
  if (!isRecord(value)) throw new Error(`Tool activity ${source} is not an object.`);
  const labels = isRecord(value.labels) ? value.labels : value;
  const batchLabels = value.batchLabels;
  if (!isRecord(batchLabels) || !isFrontendMessageKey(batchLabels.active) || !isFrontendMessageKey(batchLabels.completed)) {
    throw new Error(`Tool activity ${source} has invalid batch message keys.`);
  }
  return { ...parseLabels(labels, source), batchLabels: { active: batchLabels.active, completed: batchLabels.completed } };
}

function readStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("Tool activity match values must be string arrays.");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
