import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { readAgentString, readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { AgentPiToolObservationContractRevision } from "../PiShared/AgentPiToolObservationProtocol.js";
import {
  isAgentPiObservationContextProjected,
  isAgentPiObservationSourceBounded,
  isAgentPiToolResultMessage,
  readAgentPiMessageTextContent,
  readAgentPiToolObservation,
} from "./AgentPiToolObservation.js";
import { AgentPiSessionCustomEntryTypes } from "./AgentPiSessionEntries.js";

export type AgentPiSessionHistoryReader = Pick<SessionManager, "buildSessionContext">;
export type AgentPiSessionContractReader = Pick<SessionManager, "buildSessionContext" | "getBranch">;
export type AgentPiSessionContractWriter = Pick<SessionManager, "appendCustomEntry">;

const RuntimeContractRevisionKey = "toolObservation";

/** Pi initializes new sessions with metadata entries; only context messages make history non-empty. */
export function isAgentPiConversationHistoryEmpty(sessionManager: AgentPiSessionHistoryReader): boolean {
  return sessionManager.buildSessionContext().messages.length === 0;
}

export function isAgentPiSessionRuntimeContractCurrent(sessionManager: AgentPiSessionContractReader): boolean {
  return sessionManager.getBranch().some((entry) => {
    if (!("customType" in entry) || entry.customType !== AgentPiSessionCustomEntryTypes.RuntimeContract) return false;
    return (
      readAgentString(
        readAgentUnknownRecord("data" in entry ? entry.data : undefined)?.[RuntimeContractRevisionKey],
      ) === AgentPiToolObservationContractRevision
    );
  });
}

export function stampAgentPiSessionRuntimeContract(sessionManager: AgentPiSessionContractWriter): void {
  sessionManager.appendCustomEntry(AgentPiSessionCustomEntryTypes.RuntimeContract, {
    [RuntimeContractRevisionKey]: AgentPiToolObservationContractRevision,
  });
}

export function hasIncompatibleAgentPiToolObservationHistory(sessionManager: AgentPiSessionHistoryReader): boolean {
  return sessionManager.buildSessionContext().messages.some((message) => {
    if (!isAgentPiToolResultMessage(message)) return false;
    const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
    return (
      observation !== undefined &&
      !isAgentPiObservationSourceBounded(observation) &&
      !isAgentPiObservationContextProjected(observation)
    );
  });
}
