import { normalizeTimestamp } from "./AgentContinuitySqliteUtils.js";

export type AgentContinuityFactLifetimeKind = "omitted" | "session" | "permanent" | "timestamp";

export interface AgentContinuityFactLifetime {
  readonly kind: AgentContinuityFactLifetimeKind;
  readonly validUntil: string | null;
}

export interface AgentContinuityFactLifetimeEvent {
  readonly operation: "created" | "reinforced" | "superseded" | "retracted";
  readonly occurredAt: string;
  readonly until?: unknown;
  readonly supersededBy?: string | null;
}

/** Normalizes the model's lifetime value without making omission mean forever. */
export function resolveAgentContinuityFactLifetime(value: unknown): AgentContinuityFactLifetime {
  if (typeof value !== "string" || value.trim() === "") {
    return { kind: "omitted", validUntil: null };
  }
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === "session") return { kind: "session", validUntil: null };
  if (normalized === "permanent") return { kind: "permanent", validUntil: null };
  return {
    kind: "timestamp",
    validUntil: normalizeTimestamp(value, "Continuity fact lifetime"),
  };
}

/**
 * Merges repeated evidence for one claim version conservatively. A repeat
 * cannot accidentally shorten a permanent lifetime or replace a later expiry
 * with an earlier one; an explicit permanent value can promote a finite head.
 */
export function mergeAgentContinuityFactLifetime(currentValidUntil: string | null, incoming: unknown): string | null {
  const next = resolveAgentContinuityFactLifetime(incoming);
  if (next.kind === "permanent") return null;
  if (next.kind !== "timestamp") return currentValidUntil;
  if (currentValidUntil === null) return null;
  return currentValidUntil >= next.validUntil! ? currentValidUntil : next.validUntil;
}

export function resolveAgentContinuityFactVersionStart(events: readonly AgentContinuityFactLifetimeEvent[]): string {
  const ordered = orderEvents(events);
  const index = lastVersionStartIndex(ordered);
  if (index < 0) throw new Error("Continuity fact history has no active version.");
  return ordered[index]!.occurredAt;
}

/** Rebuilds one active version's lifetime from its physical evidence history. */
export function resolveAgentContinuityFactVersionLifetime(
  events: readonly AgentContinuityFactLifetimeEvent[],
): string | null {
  const ordered = orderEvents(events);
  const index = lastVersionStartIndex(ordered);
  if (index < 0) throw new Error("Continuity fact history has no active version.");
  let validUntil: string | null = null;
  for (const [offset, event] of ordered.slice(index).entries()) {
    if (event.operation === "retracted" || event.supersededBy) continue;
    validUntil = mergeVersionLifetime(validUntil, event.until, offset === 0);
  }
  return validUntil;
}

function mergeVersionLifetime(current: string | null, incoming: unknown, first: boolean): string | null {
  if (first) return resolveAgentContinuityFactLifetime(incoming).validUntil;
  return mergeAgentContinuityFactLifetime(current, incoming);
}

function orderEvents(events: readonly AgentContinuityFactLifetimeEvent[]): AgentContinuityFactLifetimeEvent[] {
  return [...events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}

function lastVersionStartIndex(events: readonly AgentContinuityFactLifetimeEvent[]): number {
  let index = -1;
  events.forEach((event, eventIndex) => {
    if ((event.operation === "created" || event.operation === "superseded") && !event.supersededBy) {
      index = eventIndex;
    }
  });
  if (index >= 0) return index;

  // A deleted source can remove the original creation marker while leaving a
  // reinforcement. The surviving event is still a physical witness for the
  // version, so rebuild from its earliest remaining entry.
  return events.length > 0 ? 0 : -1;
}
