import type { AgentEvent as AgentSessionEvent } from "@earendil-works/pi-agent-core";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";

export const AgentPiDiagnosticSources = {
  Session: "session",
  Proxy: "proxy",
  Substrate: "substrate",
} as const;

export type AgentPiDiagnosticSource = (typeof AgentPiDiagnosticSources)[keyof typeof AgentPiDiagnosticSources];

export interface AgentPiDiagnosticContext {
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly step?: number;
}

export interface AgentPiDiagnosticInput {
  readonly context?: AgentPiDiagnosticContext;
  readonly source: AgentPiDiagnosticSource;
  readonly name: string;
  readonly summary?: string;
  readonly details?: unknown;
}

export interface AgentPiDiagnosticEvent {
  readonly context: AgentPiDiagnosticContext;
  readonly source: AgentPiDiagnosticSource;
  readonly name: string;
  readonly summary: string;
  readonly details?: unknown;
}

export type AgentPiDiagnosticSink = (event: AgentPiDiagnosticEvent) => void | Promise<void>;

const SensitiveDiagnosticKeyNames = new Set(["authorization", "secret", "password", "credential"]);
const SensitiveTokenQualifiers = new Set(["access", "api", "auth", "bearer", "csrf", "id", "refresh", "session"]);
const MaxDiagnosticStringLength = 1_024;
const MaxDiagnosticStringCharacters = 16_384;
const MaxDiagnosticEntries = 24;
const MaxDiagnosticDepth = 4;

interface DiagnosticProjectionBudget {
  remainingEntries: number;
  remainingStringCharacters: number;
}

export async function emitAgentPiDiagnostic(
  sink: AgentPiDiagnosticSink | undefined,
  input: AgentPiDiagnosticInput,
): Promise<void> {
  if (!sink) return;
  await sink(createAgentPiDiagnosticEvent(input));
}

export function createAgentPiDiagnosticEvent(input: AgentPiDiagnosticInput): AgentPiDiagnosticEvent {
  return {
    context: input.context ?? {},
    source: input.source,
    name: input.name,
    summary: input.summary ?? summarizeDiagnosticDetails(input.details),
    details: sanitizeDiagnosticDetails(input.details),
  };
}

export function projectPiSessionDiagnosticEvent(options: {
  context: AgentPiDiagnosticContext;
  event: AgentSessionEvent;
}): AgentPiDiagnosticEvent {
  return createAgentPiDiagnosticEvent({
    context: options.context,
    source: AgentPiDiagnosticSources.Session,
    name: options.event.type,
    summary: summarizePiSessionEvent(options.event),
    details: options.event,
  });
}

export function createAgentPiDiagnosticLogger(logger: AgentLogger): AgentPiDiagnosticSink {
  return (event) => {
    const label = `pi.${event.source}.${event.name}`;
    logger.info(label, {
      ...event.context,
      summary: event.summary || undefined,
    });
    if (event.details !== undefined) logger.tree(`${label} details`, event.details);
  };
}

function summarizePiSessionEvent(event: AgentSessionEvent): string {
  const summaryProjectors: Partial<Record<AgentSessionEvent["type"], (event: AgentSessionEvent) => string>> = {
    message_update: (value) => `message_update text=${readAssistantText(value).length}`,
    tool_execution_start: (value) => `tool_start ${readRecord(value)?.toolName ?? ""}`,
    tool_execution_end: (value) => `tool_end ${readRecord(value)?.toolName ?? ""}`,
    agent_start: () => "agent_start",
    agent_end: () => "agent_end",
    turn_start: () => "turn_start",
    turn_end: () => "turn_end",
    message_start: () => "message_start",
    message_end: () => "message_end",
  };
  return summaryProjectors[event.type]?.(event) ?? event.type;
}

function summarizeDiagnosticDetails(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return summarizeText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const record = readRecord(value);
  if (!record) return "";
  return takeEnumerableEntries(record, 6)
    .entries.map(([key, entry]) => `${key}=${isSensitiveDiagnosticKey(key) ? "[redacted]" : summarizePrimitive(entry)}`)
    .join(" ");
}

function sanitizeDiagnosticDetails(
  value: unknown,
  budget: DiagnosticProjectionBudget = createDiagnosticProjectionBudget(),
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return projectDiagnosticString(value, budget);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MaxDiagnosticDepth) return "[truncated]";
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const entries: unknown[] = [];
    for (const entry of value) {
      if (!consumeDiagnosticEntry(budget)) break;
      entries.push(sanitizeDiagnosticDetails(entry, budget, seen, depth + 1));
    }
    if (entries.length < value.length) entries.push(`[${value.length - entries.length} additional entries omitted]`);
    return entries;
  }

  const record = readRecord(value);
  if (!record) return String(value);
  if (seen.has(record)) return "[circular]";
  seen.add(record);

  const entries: Array<[string, unknown]> = [];
  let truncated = false;
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    if (!consumeDiagnosticEntry(budget)) {
      truncated = true;
      break;
    }
    entries.push([
      summarizeText(key, 128),
      isSensitiveDiagnosticKey(key) ? "[redacted]" : sanitizeDiagnosticDetails(record[key], budget, seen, depth + 1),
    ]);
  }
  const sanitized = Object.fromEntries(entries);
  if (truncated) sanitized["[truncated]"] = "additional properties omitted";
  return sanitized;
}

function isSensitiveDiagnosticKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.some((word) => SensitiveDiagnosticKeyNames.has(word))) return true;
  if (words.length === 1 && words[0] === "token") return true;

  const tokenIndex = words.indexOf("token");
  return tokenIndex >= 0 && words.some((word, index) => index !== tokenIndex && SensitiveTokenQualifiers.has(word));
}

function createDiagnosticProjectionBudget(): DiagnosticProjectionBudget {
  return {
    remainingEntries: MaxDiagnosticEntries,
    remainingStringCharacters: MaxDiagnosticStringCharacters,
  };
}

function consumeDiagnosticEntry(budget: DiagnosticProjectionBudget): boolean {
  if (budget.remainingEntries <= 0) return false;
  budget.remainingEntries -= 1;
  return true;
}

function projectDiagnosticString(value: string, budget: DiagnosticProjectionBudget): string {
  const limit = Math.min(MaxDiagnosticStringLength, budget.remainingStringCharacters);
  if (limit <= 0) return "[truncated]";
  const projected = summarizeText(value, limit);
  budget.remainingStringCharacters = Math.max(0, budget.remainingStringCharacters - projected.length);
  return projected;
}

function takeEnumerableEntries(
  record: Record<string, unknown>,
  limit: number,
): { entries: Array<[string, unknown]>; truncated: boolean } {
  const entries: Array<[string, unknown]> = [];
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    if (entries.length === limit) return { entries, truncated: true };
    entries.push([key, record[key]]);
  }
  return { entries, truncated: false };
}

function summarizePrimitive(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return summarizeText(value, 80);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  return "{...}";
}

function readAssistantText(event: AgentSessionEvent): string {
  const message = readRecord(event)?.message;
  const content = readRecord(message)?.content;
  return Array.isArray(content)
    ? content
        .flatMap((entry) => {
          const record = readRecord(entry);
          return record?.type === "text" && typeof record.text === "string" ? [record.text] : [];
        })
        .join("")
    : "";
}

function summarizeText(value: string, maxLength = 1_200): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...[truncated]` : value;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
