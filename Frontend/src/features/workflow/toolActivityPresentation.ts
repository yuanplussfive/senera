import type { ToolEventOrigin } from "../../api/eventTypes";
import RawToolActivityMap from "./toolActivityPresentation.map.json";
import { isRecord, readStringArray } from "./presentationMapParsing";

export type ToolActivityStatus = "active" | "completed" | "failed";

export interface ToolActivityInput {
  readonly toolName: string;
  readonly origin?: ToolEventOrigin;
  readonly arguments?: unknown;
  readonly status: ToolActivityStatus;
}

interface ToolActivityPresentation {
  readonly action: string;
}

interface ToolActivityRule extends ToolActivityPresentation {
  readonly id: string;
  readonly invocationName?: string;
  readonly exactCapabilities?: readonly string[];
  readonly capabilityPrefixes?: readonly string[];
  readonly exactToolNames?: readonly string[];
  readonly toolNamePrefixes?: readonly string[];
  readonly argumentPath?: string;
  readonly detailPaths?: readonly string[];
}

interface ToolActivityMap {
  readonly version: 4;
  readonly default: ToolActivityPresentation;
  readonly mcp: ToolActivityPresentation;
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
  readonly argumentPreview?: string;
}

export function projectToolActivityInspection(input: ToolActivityInput): ToolActivityInspection {
  const rule = resolveRule(input.toolName, input.origin?.capability);
  const presentation = input.origin?.kind === "mcp" ? ToolActivityMap.mcp : (rule ?? ToolActivityMap.default);
  const command = rule?.argumentPath ? readStringAtPath(input.arguments, rule.argumentPath) : undefined;
  const toolName = displayToolName(input.toolName, input.origin);
  const subjects = uniqueStrings((rule?.detailPaths ?? []).flatMap((path) => readStringsAtPath(input.arguments, path)));
  const argumentPreview = readActivityArgumentPreview({
    command,
    subjects,
    arguments: input.arguments,
  });
  const actionLabel = [
    presentation.action,
    rule?.invocationName,
    input.origin?.kind === "mcp" || !rule ? toolName : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    // Completion and failure are expressed by the row marker. Keep copy to one compact action.
    label: appendArgumentPreview(actionLabel, argumentPreview),
    category: input.origin?.kind === "mcp" ? "mcp" : (rule?.id ?? "system"),
    subjects,
    argumentPreview,
  };
}

export function projectToolBatchAction(
  input: Pick<ToolActivityInput, "toolName" | "origin" | "arguments" | "status">,
): {
  readonly category: string;
  readonly label: string;
} {
  const inspection = projectToolActivityInspection(input);
  return {
    category: inspection.category,
    label: inspection.label,
  };
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
      ? (rule.exactCapabilities?.filter((value) => value === capability).map((value) => 4_000 + value.length) ?? [])
      : []),
    ...(capability
      ? (rule.capabilityPrefixes
          ?.filter((value) => capability.startsWith(value))
          .map((value) => 3_000 + value.length) ?? [])
      : []),
    ...(rule.exactToolNames?.filter((value) => value === toolName).map((value) => 2_000 + value.length) ?? []),
    ...(rule.toolNamePrefixes?.filter((value) => toolName.startsWith(value)).map((value) => 1_000 + value.length) ??
      []),
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

function appendArgumentPreview(label: string, argumentPreview: string | undefined): string {
  return argumentPreview ? `${label} · ${argumentPreview}` : label;
}

function readActivityArgumentPreview({
  command,
  subjects,
  arguments: value,
}: {
  readonly command?: string;
  readonly subjects: readonly string[];
  readonly arguments?: unknown;
}): string | undefined {
  const supplemental = command ? subjects.filter((subject) => subject !== command) : subjects;
  const values = [
    ...(command ? [command] : []),
    ...(supplemental.length > 0 ? supplemental : !command && subjects.length === 0 ? collectArgumentValues(value) : []),
  ];
  return compactArgumentValues(values);
}

function collectArgumentValues(value: unknown): string[] {
  const entries: string[] = [];
  const visit = (current: unknown, path: string[], depth: number): void => {
    if (entries.length >= 3 || depth > 2 || current === null || current === undefined) return;
    if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") {
      const text = String(current).trim();
      if (text) entries.push(path.length > 0 ? `${path.join(".")}=${text}` : text);
      return;
    }
    if (Array.isArray(current)) {
      current.slice(0, 2).forEach((entry, index) => visit(entry, [...path, String(index + 1)], depth + 1));
      return;
    }
    if (!isRecord(current)) return;
    Object.entries(current).forEach(([key, entry]) => {
      if (!isSensitiveArgumentKey(key)) visit(entry, [...path, key], depth + 1);
    });
  };
  visit(value, [], 0);
  return entries;
}

function isSensitiveArgumentKey(key: string): boolean {
  return /authorization|credential|cookie|password|secret|token|api[-_]?key/iu.test(key);
}

function compactArgumentValues(values: readonly string[]): string | undefined {
  const normalized = [...new Set(values.map(compactPreview).filter(Boolean))].slice(0, 3);
  if (normalized.length === 0) return undefined;
  return compactPreview(normalized.join(" · "));
}

function compactPreview(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}

function parseToolActivityMap(value: unknown): ToolActivityMap {
  if (!isRecord(value) || value.version !== 4 || !isRecord(value.default) || !isRecord(value.origins)) {
    throw new Error("Tool activity presentation map has an unsupported structure.");
  }
  const defaultPresentation = parsePresentation(value.default, "default");
  const mcp = parsePresentation(value.origins.mcp, "MCP origin");
  const rules = Array.isArray(value.capabilityRules) ? value.capabilityRules.map(parseRule) : [];
  return {
    version: 4,
    default: defaultPresentation,
    mcp,
    rules,
  };
}

function parseRule(value: unknown): ToolActivityRule {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.match)) {
    throw new Error("Tool activity rule is missing its identity or match.");
  }
  const exactCapabilities = readStringArray(value.match.exactCapabilities, "Tool activity match values");
  const capabilityPrefixes = readStringArray(value.match.capabilityPrefixes, "Tool activity match values");
  const exactToolNames = readStringArray(value.match.exactToolNames, "Tool activity match values");
  const toolNamePrefixes = readStringArray(value.match.toolNamePrefixes, "Tool activity match values");
  if (!exactCapabilities && !capabilityPrefixes && !exactToolNames && !toolNamePrefixes) {
    throw new Error(`Tool activity rule '${value.id}' has no match.`);
  }
  return {
    id: value.id,
    invocationName: readOptionalString(value.invocationName, "invocationName"),
    exactCapabilities,
    capabilityPrefixes,
    exactToolNames,
    toolNamePrefixes,
    argumentPath: readOptionalString(value.argumentPath, "argumentPath"),
    detailPaths: readStringArray(value.detailPaths, "Tool activity detailPaths"),
    ...parsePresentation(value, `rule '${value.id}'`),
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => compactPreview(value)).filter(Boolean))];
}

function parsePresentation(value: unknown, source: string): ToolActivityPresentation {
  if (!isRecord(value) || typeof value.action !== "string" || !value.action.trim()) {
    throw new Error(`Tool activity ${source} must declare a compact action.`);
  }
  return { action: value.action.trim() };
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Tool activity ${field} must be a non-empty string when provided.`);
  }
  return value.trim();
}
