import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { z } from "zod";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import { readAgentString, readAgentUnknownRecord, type AgentUnknownRecord } from "../Core/AgentUnknownValue.js";
export {
  AgentPiToolObservationStatuses,
  type AgentPiToolObservationStatus,
  readAgentPiToolObservationStatus,
} from "../PiShared/AgentPiToolObservationStatus.js";

export const AgentPiToolObservationProtocol = defineSeneraProtocol("tool_observation", 1);
export const AgentPiToolObservationContextViewProtocol = defineSeneraProtocol("tool_observation_context_view", 1);
export const AgentPiToolObservationSourceViewProtocol = defineSeneraProtocol("tool_observation_source_view", 1);

const AgentPiToolObservationSchema = z
  .object({
    type: z.literal(AgentPiToolObservationProtocol.type),
  })
  .passthrough();

const AgentPiToolObservationContextViewSchema = z
  .object({
    type: z.literal(AgentPiToolObservationContextViewProtocol.type),
  })
  .passthrough();

export type AgentPiToolObservation = z.infer<typeof AgentPiToolObservationSchema>;

const AgentPiToolObservationDetailKeys = [
  "semantic_digest",
  "headline",
  "summary",
  "outcome",
  "error",
  "process",
  "retrieval",
  "continuation",
  "delta",
  "summary_facts",
  "evidence",
  "result",
  "arguments",
  "projection",
  "workspace",
] as const;

const AgentPiToolObservationFallbackKeys = [
  "semantic_digest",
  "headline",
  "summary",
  "process",
  "summary_facts",
  "evidence",
  "delta",
  "workspace",
  "retrieval",
  "continuation",
  "projection",
] as const;

export function readAgentPiToolObservation(content: string): AgentPiToolObservation | undefined {
  try {
    const parsed = AgentPiToolObservationSchema.safeParse(JSON.parse(content) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function createAgentPiToolObservation<T extends AgentUnknownRecord>(fields: T): T & AgentPiToolObservation {
  return { ...fields, type: AgentPiToolObservationProtocol.type };
}

export function createAgentPiToolObservationContextView<T extends AgentUnknownRecord>(
  fields: T,
): T & z.infer<typeof AgentPiToolObservationContextViewSchema> {
  return { ...fields, type: AgentPiToolObservationContextViewProtocol.type };
}

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

export function isAgentPiObservationContextProjected(observation: AgentPiToolObservation): boolean {
  return AgentPiToolObservationContextViewSchema.safeParse(observation.context_view).success;
}

export function isAgentPiObservationSourceBounded(observation: AgentPiToolObservation): boolean {
  return readAgentUnknownRecord(observation.observation_view)?.type === AgentPiToolObservationSourceViewProtocol.type;
}

export function agentPiToolObservationIdentity(observation: AgentPiToolObservation): string {
  return [
    readAgentPiObservationBatchId(observation),
    readAgentString(observation.call_id) ?? "",
    readAgentString(observation.tool_name) ?? "",
  ].join("\u0000");
}

export function projectAgentPiToolObservationDetail(observation: AgentPiToolObservation): AgentUnknownRecord {
  const detail = readAgentUnknownRecord(observation.detail);
  if (detail) return detail;
  return projectObservationKeys(observation, AgentPiToolObservationDetailKeys);
}

export function projectAgentPiToolObservationFallback(observation: AgentPiToolObservation): AgentUnknownRecord {
  const detail = readAgentUnknownRecord(observation.detail);
  if (detail) return detail;
  return projectObservationKeys(observation, AgentPiToolObservationFallbackKeys);
}

function projectObservationKeys(
  observation: AgentPiToolObservation,
  keys: readonly (keyof AgentPiToolObservation)[],
): AgentUnknownRecord {
  return Object.fromEntries(keys.flatMap((key) => (observation[key] === undefined ? [] : [[key, observation[key]]])));
}
