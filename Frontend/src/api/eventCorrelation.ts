import type { EventEnvelope } from "./eventTypes";

/**
 * Event producers normally put the session on the envelope. Snapshot
 * producers may also carry it in their data payload, so consumers that keep
 * a session-scoped view use one correlation rule instead of each inventing a
 * slightly different fallback.
 */
export function readEventSessionId(env: Pick<EventEnvelope, "sessionId" | "data">): string | undefined {
  const envelopeSessionId = readNonEmptyString(env.sessionId);
  if (envelopeSessionId) return envelopeSessionId;
  if (!isRecord(env.data)) return undefined;
  return readNonEmptyString(env.data.sessionId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
