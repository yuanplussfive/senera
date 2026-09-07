import { Temporal } from "@js-temporal/polyfill";
import type { AgentWorldEvent } from "./AgentWorldEventLedger.js";

export interface AgentWorldTimelineRollupRule {
  readonly rollupType: string;
  readonly coveredTypes: readonly string[];
}

export interface AgentWorldTimelineProjectionPolicy {
  readonly rollups: readonly AgentWorldTimelineRollupRule[];
}

/**
 * A rollup is a read-model boundary, never a destructive rewrite. The child
 * events remain in the ledger and can always be recovered through evidence.
 */
export const DefaultAgentWorldTimelineProjectionPolicy: AgentWorldTimelineProjectionPolicy = Object.freeze({
  rollups: Object.freeze([
    Object.freeze({
      rollupType: "conversation.segment.completed",
      coveredTypes: Object.freeze(["conversation.turn.completed"]),
    }),
  ]),
});

export function projectAgentWorldTimeline(input: {
  readonly events: readonly AgentWorldEvent[];
  readonly localDate: string;
  readonly limit: number;
  readonly policy?: AgentWorldTimelineProjectionPolicy;
}): readonly AgentWorldEvent[] {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
    throw new RangeError(`World timeline limit must be a positive safe integer: ${input.limit}`);
  }
  const policy = input.policy ?? DefaultAgentWorldTimelineProjectionPolicy;
  const coveredIds = new Set<string>();
  for (const rule of policy.rollups) {
    const rollups = input.events.filter((event) => event.type === rule.rollupType);
    const coveredTypes = new Set(rule.coveredTypes);
    for (const rollup of rollups) {
      for (const event of input.events) {
        if (!coveredTypes.has(event.type) || !isNotAfter(event, rollup)) continue;
        if (sharesEvidence(event, rollup)) coveredIds.add(event.id);
      }
    }
  }
  return input.events
    .filter((event) => event.localDate === input.localDate && !coveredIds.has(event.id))
    .slice(-input.limit);
}

function sharesEvidence(left: AgentWorldEvent, right: AgentWorldEvent): boolean {
  const rightRefs = new Set(right.evidenceRefs);
  return left.evidenceRefs.some((reference) => rightRefs.has(reference));
}

function isNotAfter(event: AgentWorldEvent, rollup: AgentWorldEvent): boolean {
  return (
    Temporal.Instant.compare(Temporal.Instant.from(event.occurredAt), Temporal.Instant.from(rollup.occurredAt)) <= 0
  );
}
