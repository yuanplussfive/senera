import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  assertAgentPiToolObservationBounded,
  type AgentPiToolObservation,
} from "../PiShared/AgentPiToolObservationProtocol.js";
export {
  AgentPiToolObservationProtocol,
  AgentPiToolObservationProtocolError,
  AgentPiToolObservationSourceViewProtocol,
  assertAgentPiToolObservationBounded,
  createAgentPiToolObservation,
  isAgentPiObservationSourceBounded,
  parseAgentPiToolObservation,
  readAgentPiToolObservation,
  type AgentPiToolObservation,
} from "../PiShared/AgentPiToolObservationProtocol.js";
export {
  AgentPiToolObservationStatuses,
  type AgentPiToolObservationStatus,
  readAgentPiToolObservationStatus,
} from "../PiShared/AgentPiToolObservationStatus.js";

export function readAgentPiMessageTextContent(message: Extract<AgentMessage, { role: "toolResult" }>): string {
  return message.content.flatMap((entry) => (entry.type === "text" ? [entry.text] : [])).join("");
}

export function isAgentPiToolResultMessage(
  message: AgentMessage,
): message is Extract<AgentMessage, { role: "toolResult" }> {
  return message.role === "toolResult";
}

export function readAgentPiToolObservationArtifactUri(observation: AgentPiToolObservation): string | undefined {
  return observation.observation_view.artifact_uri;
}

export function projectAgentPiToolObservationDetail(
  observation: AgentPiToolObservation,
): AgentPiToolObservation["detail"] {
  assertAgentPiToolObservationBounded(observation);
  return observation.detail;
}
