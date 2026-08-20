import { z } from "zod";
import {
  AgentToolExecutionStatuses,
  AgentToolFailureSchema,
  AgentToolOutputAvailabilities,
} from "../ToolRuntime/AgentToolResultOutcome.js";

export const AgentPiToolResultStatuses = {
  Success: "success",
  Failure: "failure",
  Unassessed: "unassessed",
} as const;

const AgentPiToolResultContextSchema = z.object({
  toolName: z.string().trim().min(1),
  artifactUri: z.string().trim().min(1).optional(),
  callId: z.string().trim().min(1).optional(),
  executionStatus: z.enum(AgentToolExecutionStatuses),
  outputAvailability: z.enum(AgentToolOutputAvailabilities),
});

const AgentPiSuccessfulToolResultSchema = AgentPiToolResultContextSchema.extend({
  status: z.literal(AgentPiToolResultStatuses.Success),
}).strict();

const AgentPiUnassessedToolResultSchema = AgentPiToolResultContextSchema.extend({
  status: z.literal(AgentPiToolResultStatuses.Unassessed),
}).strict();

const AgentPiFailedToolResultSchema = AgentPiToolResultContextSchema.extend({
  status: z.literal(AgentPiToolResultStatuses.Failure),
  error: AgentToolFailureSchema,
}).strict();

export const AgentPiToolDetailsSchema = z
  .object({
    senera: z.discriminatedUnion("status", [
      AgentPiSuccessfulToolResultSchema,
      AgentPiUnassessedToolResultSchema,
      AgentPiFailedToolResultSchema,
    ]),
  })
  .strict();

export type AgentPiToolDetails = z.infer<typeof AgentPiToolDetailsSchema>;
export type AgentPiToolResultStatus = AgentPiToolDetails["senera"]["status"];

export function parseAgentPiToolDetails(value: unknown): AgentPiToolDetails | undefined {
  const parsed = AgentPiToolDetailsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
