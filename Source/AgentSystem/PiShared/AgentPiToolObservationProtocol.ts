import { z } from "zod";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import { readAgentUnknownRecord, type AgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";

export const AgentPiToolObservationProtocol = defineSeneraProtocol("tool_observation", 1);
export const AgentPiToolObservationContextViewProtocol = defineSeneraProtocol("tool_observation_context_view", 1);
export const AgentPiToolObservationSourceViewProtocol = defineSeneraProtocol("tool_observation_source_view", 1);
export const AgentPiToolObservationContractRevision = [
  AgentPiToolObservationProtocol.type,
  AgentPiToolObservationSourceViewProtocol.type,
  AgentPiToolObservationContextViewProtocol.type,
].join("|");

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

export class AgentPiToolObservationProtocolError extends AgentLocalizedError {
  constructor() {
    super("pi.toolObservationContractMissing", {
      sourceType: AgentPiToolObservationSourceViewProtocol.type,
      contextType: AgentPiToolObservationContextViewProtocol.type,
    });
  }
}

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

export function isAgentPiObservationContextProjected(observation: AgentPiToolObservation): boolean {
  return AgentPiToolObservationContextViewSchema.safeParse(observation.context_view).success;
}

export function isAgentPiObservationSourceBounded(observation: AgentPiToolObservation): boolean {
  return readAgentUnknownRecord(observation.observation_view)?.type === AgentPiToolObservationSourceViewProtocol.type;
}

export function assertAgentPiToolObservationBounded(observation: AgentPiToolObservation): void {
  if (isAgentPiObservationSourceBounded(observation) || isAgentPiObservationContextProjected(observation)) return;
  throw new AgentPiToolObservationProtocolError();
}
