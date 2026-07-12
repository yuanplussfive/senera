import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";

export function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function parseStoredRunEvent(value: string): AgentEventEnvelope | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const record = parsed as Partial<AgentEventEnvelope>;
    return typeof record.kind === "string" &&
      typeof record.timestamp === "string" &&
      typeof record.sequence === "number" &&
      typeof record.channel === "string"
      ? (record as AgentEventEnvelope)
      : undefined;
  } catch {
    return undefined;
  }
}

export function readRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
}

export function readStringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function readNumberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
