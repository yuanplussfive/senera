import { z } from "zod";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { AgentPiToolObservationStatuses } from "./AgentPiToolObservationStatus.js";
import { AgentToolExecutionStatuses, AgentToolOutputAvailabilities } from "../ToolRuntime/AgentToolResultOutcome.js";

export const AgentPiToolObservationProtocol = defineSeneraProtocol("tool_observation", 3);
export const AgentPiToolObservationSourceViewProtocol = defineSeneraProtocol("tool_observation_source_view", 3);
export const AgentPiToolObservationContractRevision = [
  AgentPiToolObservationProtocol.type,
  AgentPiToolObservationSourceViewProtocol.type,
].join("|");

const AgentPiToolObservationErrorSchema = z
  .object({
    code: z.string().optional(),
    kind: z.string().optional(),
    source: z.string().optional(),
    retryable: z.boolean().optional(),
    message: z.string().optional(),
  })
  .strict();

const AgentPiToolObservationEvidenceSchema = z
  .object({
    evidence_uri: z.string().optional(),
    kind: z.string().optional(),
    locator: z.string().optional(),
    display: z.string().optional(),
    label: z.string().optional(),
    source: z.string().optional(),
    confidence: z.number().optional(),
    artifact_uri: z.string().optional(),
    artifact_refs: z.array(z.string()).optional(),
    facts: z.array(z.unknown()).optional(),
  })
  .strict();

const AgentPiToolObservationDetailSchema = z
  .object({
    headline: z.unknown().optional(),
    summary: z.unknown().optional(),
    error_detail: z.unknown().optional(),
    process: z.unknown().optional(),
    retrieval: z.unknown().optional(),
    continuation: z.unknown().optional(),
    evidence: z.array(AgentPiToolObservationEvidenceSchema).default([]),
    delta: z.unknown().optional(),
    workspace: z.unknown().optional(),
    result: z.unknown().optional(),
    arguments: z.unknown().optional(),
    projection: z.unknown().optional(),
    summary_facts: z.unknown().optional(),
    limitations: z.unknown().optional(),
    outcome: z.unknown().optional(),
    semantic_digest: z.string().optional(),
  })
  .strict();

const AgentPiToolObservationSourceViewSchema = z
  .object({
    type: z.literal(AgentPiToolObservationSourceViewProtocol.type),
    complete: z.boolean(),
    omission_count: z.number().int().nonnegative(),
    omissions: z
      .array(
        z
          .object({
            path: z.string(),
            reason: z.string(),
            omitted: z.number().int().nonnegative().optional(),
          })
          .strict(),
      )
      .default([]),
    artifact_uri: z.string().optional(),
  })
  .strict();

const AgentPiToolObservationSchema = z
  .object({
    type: z.literal(AgentPiToolObservationProtocol.type),
    status: z.enum(AgentPiToolObservationStatuses),
    execution_status: z.enum(AgentToolExecutionStatuses),
    output_availability: z.enum(AgentToolOutputAvailabilities),
    error: AgentPiToolObservationErrorSchema.optional(),
    observation_view: AgentPiToolObservationSourceViewSchema,
    detail: AgentPiToolObservationDetailSchema,
  })
  .strict();

export type AgentPiToolObservation = z.infer<typeof AgentPiToolObservationSchema>;
export type AgentPiToolObservationSourceView = z.infer<typeof AgentPiToolObservationSourceViewSchema>;

export class AgentPiToolObservationProtocolError extends AgentLocalizedError {
  constructor(options: ErrorOptions = {}) {
    super(
      "pi.toolObservationContractMissing",
      {
        sourceType: AgentPiToolObservationSourceViewProtocol.type,
      },
      options,
    );
  }
}

export function readAgentPiToolObservation(content: string): AgentPiToolObservation | undefined {
  try {
    return AgentPiToolObservationSchema.safeParse(JSON.parse(content) as unknown).data;
  } catch {
    return undefined;
  }
}

export function parseAgentPiToolObservation(value: unknown): AgentPiToolObservation {
  const parsed = AgentPiToolObservationSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new AgentPiToolObservationProtocolError({ cause: parsed.error });
}

export function createAgentPiToolObservation(fields: Omit<AgentPiToolObservation, "type">): AgentPiToolObservation {
  return parseAgentPiToolObservation({ ...fields, type: AgentPiToolObservationProtocol.type });
}

export function isAgentPiObservationSourceBounded(observation: AgentPiToolObservation): boolean {
  return observation.observation_view.type === AgentPiToolObservationSourceViewProtocol.type;
}

export function assertAgentPiToolObservationBounded(observation: AgentPiToolObservation): void {
  if (isAgentPiObservationSourceBounded(observation)) return;
  throw new AgentPiToolObservationProtocolError();
}
