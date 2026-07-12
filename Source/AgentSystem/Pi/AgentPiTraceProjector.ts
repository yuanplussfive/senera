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

const SensitiveKeyPattern = /api[-_]?key|authorization|token|secret|password/i;

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
  return Object.entries(record)
    .slice(0, 6)
    .map(([key, entry]) => `${key}=${summarizePrimitive(entry)}`)
    .join(" ");
}

function sanitizePiTracePayload(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    return value.map((entry) => sanitizePiTracePayload(entry, seen));
  }

  const record = readRecord(value);
  if (!record) return String(value);
  if (seen.has(record)) return "[circular]";
  seen.add(record);

  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      SensitiveKeyPattern.test(key) ? "[redacted]" : sanitizePiTracePayload(entry, seen),
    ]),
  );
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
