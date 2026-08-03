/**
 * Tool observation status enum, type, and reader function.
 *
 * Extracted from Pi/AgentPiToolObservation.ts to break the Pi ↔ PiProxy
 * circular dependency. These symbols have no Pi/ business-logic dependencies
 * and are needed by both Pi/ and PiProxy/ consumers.
 */

export const AgentPiToolObservationStatuses = {
  Success: "success",
  Failure: "failure",
  Unassessed: "unassessed",
  Waiting: "waiting",
  Unknown: "unknown",
} as const;

export type AgentPiToolObservationStatus =
  (typeof AgentPiToolObservationStatuses)[keyof typeof AgentPiToolObservationStatuses];

const AgentPiToolObservationStatusValues: ReadonlySet<unknown> = new Set(Object.values(AgentPiToolObservationStatuses));

export function readAgentPiToolObservationStatus(value: unknown): AgentPiToolObservationStatus {
  return isAgentPiToolObservationStatus(value) ? value : AgentPiToolObservationStatuses.Unknown;
}

function isAgentPiToolObservationStatus(value: unknown): value is AgentPiToolObservationStatus {
  return AgentPiToolObservationStatusValues.has(value);
}
