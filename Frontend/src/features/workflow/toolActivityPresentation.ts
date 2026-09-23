import { resolveFrontendLocalizedText } from "../../i18n/frontendLocaleModel";
import type { ToolEventOrigin } from "../../api/eventTypes";
import type { AgentToolPresentation } from "../../../../Source/AgentSystem/Types/AgentToolPresentationTypes";

export type ToolActivityStatus = "active" | "completed" | "failed";

export interface ToolActivityInput {
  readonly toolName: string;
  readonly origin?: ToolEventOrigin;
  readonly arguments?: unknown;
  readonly status: ToolActivityStatus;
}

export interface ToolActivityInspection {
  readonly label: string;
  readonly category: string;
  readonly subjects: readonly string[];
  readonly argumentPreview?: string;
}

const GenericSystemCategory = "system";
const GenericMcpCategory = "mcp";

/**
 * Runtime events are authoritative. The workflow has no knowledge of
 * extension names, capability prefixes, or tool-name conventions; packages
 * describe their own presentation at registration time.
 */
export function projectToolActivity(input: ToolActivityInput): string {
  return projectToolActivityInspection(input).label;
}

export function projectToolActivityInspection(input: ToolActivityInput): ToolActivityInspection {
  const presentation = input.origin?.presentation;
  const toolName = displayToolName(input.toolName, input.origin);
  const command = presentation?.activity.argumentPath
    ? readStringAtPointer(input.arguments, presentation.activity.argumentPath)
    : undefined;
  const subjects = uniqueStrings(
    (presentation?.activity.detailPaths ?? []).flatMap((pointer) => readStringsAtPointer(input.arguments, pointer)),
  );
  const argumentPreview = readActivityArgumentPreview({ command, subjects, arguments: input.arguments });
  const action = presentation
    ? resolveFrontendLocalizedText(presentation.activity.action)
    : genericAction(input.origin);
  const invocationName = presentation?.activity.invocationName
    ? resolveFrontendLocalizedText(presentation.activity.invocationName)
    : undefined;
  const includeIdentity = !presentation || input.origin?.kind === "mcp";
  const label = [action, invocationName, includeIdentity ? toolName : undefined].filter(Boolean).join(" · ");
  return {
    label: appendArgumentPreview(label, argumentPreview),
    category: presentation?.category ?? (input.origin?.kind === "mcp" ? GenericMcpCategory : GenericSystemCategory),
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
  return { category: inspection.category, label: inspection.label };
}

export function readToolPresentation(input: Pick<ToolActivityInput, "origin">): AgentToolPresentation | undefined {
  return input.origin?.presentation;
}

function genericAction(origin: ToolEventOrigin | undefined): string {
  return origin?.kind === "mcp" ? "Call" : "Use";
}

function displayToolName(toolName: string, origin: ToolEventOrigin | undefined): string {
  if (origin?.kind !== "mcp") return toolName;
  const tool = origin.tool?.trim() || toolName;
  const server = origin.server?.trim();
  return server ? `${server} · ${tool}` : tool;
}

function readStringAtPointer(value: unknown, pointer: string): string | undefined {
  return readStringsAtPointer(value, pointer)[0];
}

function readStringsAtPointer(value: unknown, pointer: string): string[] {
  const tokens = parsePointer(pointer);
  const visit = (current: unknown, index: number): string[] => {
    if (index >= tokens.length) {
      return typeof current === "string" && current.trim() ? [current.trim()] : [];
    }
    const token = tokens[index];
    if (token === "*") {
      if (Array.isArray(current)) return current.flatMap((entry) => visit(entry, index + 1));
      return isRecord(current) ? Object.values(current).flatMap((entry) => visit(entry, index + 1)) : [];
    }
    if (Array.isArray(current)) {
      return /^(?:0|[1-9]\d*)$/u.test(token) && Number(token) < current.length
        ? visit(current[Number(token)], index + 1)
        : [];
    }
    return isRecord(current) && Object.hasOwn(current, token) ? visit(current[token], index + 1) : [];
  };
  return visit(value, 0);
}

function parsePointer(pointer: string): string[] {
  return pointer === ""
    ? []
    : pointer
        .slice(1)
        .split("/")
        .map((token) => token.replace(/~1/gu, "/").replace(/~0/gu, "~"));
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(compactPreview).filter(Boolean))];
}

function compactArgumentValues(values: readonly string[]): string | undefined {
  const normalized = [...new Set(values.map(compactPreview).filter(Boolean))].slice(0, 3);
  return normalized.length > 0 ? compactPreview(normalized.join(" · ")) : undefined;
}

function compactPreview(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
