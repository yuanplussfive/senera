import { AgentPiToolResultStatuses, parseAgentPiToolDetails } from "./AgentPiToolResultDetails.js";

export interface AgentPiToolResultStatusPatch {
  readonly isError: true;
}

export function projectAgentPiToolResultStatus(details: unknown): AgentPiToolResultStatusPatch | undefined {
  return parseAgentPiToolDetails(details)?.senera.status === AgentPiToolResultStatuses.Failure
    ? { isError: true }
    : undefined;
}
