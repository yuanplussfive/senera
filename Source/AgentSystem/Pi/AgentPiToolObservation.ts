import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { readAgentString, readAgentUnknownRecord, type AgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import {
  assertAgentPiToolObservationBounded,
  type AgentPiToolObservation,
} from "../PiShared/AgentPiToolObservationProtocol.js";
export {
  AgentPiToolObservationContextViewProtocol,
  AgentPiToolObservationProtocol,
  AgentPiToolObservationProtocolError,
  AgentPiToolObservationSourceViewProtocol,
  assertAgentPiToolObservationBounded,
  createAgentPiToolObservation,
  createAgentPiToolObservationContextView,
  isAgentPiObservationContextProjected,
  isAgentPiObservationSourceBounded,
  readAgentPiToolObservation,
  type AgentPiToolObservation,
} from "../PiShared/AgentPiToolObservationProtocol.js";
export {
  AgentPiToolObservationStatuses,
  type AgentPiToolObservationStatus,
  readAgentPiToolObservationStatus,
} from "../PiShared/AgentPiToolObservationStatus.js";

export function readAgentPiMessageTextContent(message: AgentMessage): string {
  const record = readAgentUnknownRecord(message);
  const entries = Array.isArray(record?.content) ? record.content : [];
  return entries
    .flatMap((entry) => {
      const text = readAgentUnknownRecord(entry);
      return text?.type === "text" ? [readAgentString(text.text) ?? ""] : [];
    })
    .join("");
}

export function isAgentPiToolResultMessage(message: AgentMessage): boolean {
  return readAgentUnknownRecord(message)?.role === "toolResult";
}

export function writeAgentPiMessageTextContent(message: AgentMessage, content: string): AgentMessage {
  const record = readAgentUnknownRecord(message);
  if (!record) return message;
  return { ...record, content: [{ type: "text", text: content }] } as AgentMessage;
}

export function readAgentPiObservationBatchId(observation: AgentPiToolObservation): string {
  return (
    readAgentString(observation.batch_id) ??
    readAgentString(observation.call_id) ??
    readAgentString(observation.tool_name) ??
    "tool-observation"
  );
}

export function agentPiToolObservationIdentity(observation: AgentPiToolObservation): string {
  return [
    readAgentPiObservationBatchId(observation),
    readAgentString(observation.call_id) ?? "",
    readAgentString(observation.tool_name) ?? "",
  ].join("\u0000");
}

export function projectAgentPiToolObservationDetail(observation: AgentPiToolObservation): AgentUnknownRecord {
  assertAgentPiToolObservationBounded(observation);
  return readAgentUnknownRecord(observation.detail) ?? {};
}
