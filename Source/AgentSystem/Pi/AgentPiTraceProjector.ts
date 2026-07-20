import type { AgentEvent as AgentSessionEvent } from "@earendil-works/pi-agent-core";
import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";

export type AgentPiTraceSource = "session" | "proxy" | "tool_bridge" | "substrate";

export interface AgentPiTraceInput {
  sessionId?: string;
  requestId: string;
  step: number;
  source: AgentPiTraceSource;
  eventType: string;
  summary?: string;
  payload?: unknown;
}

const SensitiveTraceKeyNames = new Set(["authorization", "secret", "password", "credential"]);
const SensitiveTokenQualifiers = new Set(["access", "api", "auth", "bearer", "csrf", "id", "refresh", "session"]);
const MaxTraceStringLength = 1_024;
const MaxTracePayloadStringCharacters = 16_384;
const MaxTracePayloadEntries = 24;
const MaxTraceDepth = 4;

interface TraceProjectionBudget {
  remainingEntries: number;
  remainingStringCharacters: number;
}

export function createPiTraceEvent(input: AgentPiTraceInput): AgentDomainEvent {
  return {
    kind: AgentEventKinds.PiTrace,
    context: {
      sessionId: input.sessionId,
      requestId: input.requestId,
      step: input.step,
    },
    data: {
      source: input.source,
      eventType: input.eventType,
      summary: input.summary ?? summarizePiTracePayload(input.payload),
      payload: sanitizePiTracePayload(input.payload),
    },
  };
}

export function projectPiSessionTraceEvent(options: {
  requestId: string;
  step: number;
  event: AgentSessionEvent;
}): AgentDomainEvent {
  return createPiTraceEvent({
    requestId: options.requestId,
    step: options.step,
    source: "session",
    eventType: options.event.type,
    summary: summarizePiSessionEvent(options.event),
    payload: options.event,
  });
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

function summarizePiTracePayload(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return summarizeText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const record = readRecord(value);
  if (!record) return "";
  return takeEnumerableEntries(record, 6)
    .entries.map(([key, entry]) => `${key}=${isSensitiveTraceKey(key) ? "[redacted]" : summarizePrimitive(entry)}`)
    .join(" ");
}

function sanitizePiTracePayload(
  value: unknown,
  budget: TraceProjectionBudget = createTraceProjectionBudget(),
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return projectTraceString(value, budget);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MaxTraceDepth) return "[truncated]";
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const entries: unknown[] = [];
    for (const entry of value) {
      if (!consumeTraceEntry(budget)) break;
      entries.push(sanitizePiTracePayload(entry, budget, seen, depth + 1));
    }
    if (entries.length < value.length) {
      entries.push(`[${value.length - entries.length} additional entries omitted]`);
    }
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
    if (!consumeTraceEntry(budget)) {
      truncated = true;
      break;
    }
    entries.push([
      summarizeText(key, 128),
      isSensitiveTraceKey(key) ? "[redacted]" : sanitizePiTracePayload(record[key], budget, seen, depth + 1),
    ]);
  }
  const sanitized = Object.fromEntries(entries);
  if (truncated) {
    sanitized["[truncated]"] = "additional properties omitted";
  }
  return sanitized;
}

function isSensitiveTraceKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.some((word) => SensitiveTraceKeyNames.has(word))) return true;
  if (words.length === 1 && words[0] === "token") return true;

  const tokenIndex = words.indexOf("token");
  return tokenIndex >= 0 && words.some((word, index) => index !== tokenIndex && SensitiveTokenQualifiers.has(word));
}

function createTraceProjectionBudget(): TraceProjectionBudget {
  return {
    remainingEntries: MaxTracePayloadEntries,
    remainingStringCharacters: MaxTracePayloadStringCharacters,
  };
}

function consumeTraceEntry(budget: TraceProjectionBudget): boolean {
  if (budget.remainingEntries <= 0) return false;
  budget.remainingEntries -= 1;
  return true;
}

function projectTraceString(value: string, budget: TraceProjectionBudget): string {
  const limit = Math.min(MaxTraceStringLength, budget.remainingStringCharacters);
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
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      continue;
    }
    if (entries.length === limit) {
      return { entries, truncated: true };
    }
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

function summarizeText(value: string, maxLength = 1200): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...[truncated]` : value;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
