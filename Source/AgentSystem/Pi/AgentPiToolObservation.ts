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
  return unwrapAttributedToolObservation(
    message.content.flatMap((entry) => (entry.type === "text" ? [entry.text] : [])).join(""),
  );
}

/**
 * BAML attribution is a wire-level XML envelope. Pi's internal history keeps
 * the same text, so every observation reader must remove the envelope before
 * validating the JSON protocol.
 */
function unwrapAttributedToolObservation(content: string): string {
  const prefix = '<observation attribution="tool">';
  const suffix = "</observation>";
  if (!content.startsWith(prefix) || !content.endsWith(suffix)) return content;
  return decodeXmlText(content.slice(prefix.length, -suffix.length));
}

function decodeXmlText(content: string): string {
  return content.replace(/&quot;|&apos;|&gt;|&lt;|&amp;/g, (entity) => {
    switch (entity) {
      case "&quot;":
        return '"';
      case "&apos;":
        return "'";
      case "&gt;":
        return ">";
      case "&lt;":
        return "<";
      case "&amp;":
        return "&";
      default:
        return entity;
    }
  });
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
