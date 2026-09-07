/**
 * Tool observation status enum, type, and reader function.
 *
 * Kept in PiShared because observation producers and Pi consumers both need
 * the status vocabulary without depending on each other's implementations.
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
