import { z } from "zod";
import type { AgentToolProcessError, AgentToolProcessResponse } from "../Types/ToolRuntimeTypes.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessTypes.js";
import { agentJsonPathToPointer } from "../Diagnostics/AgentJsonPointer.js";
import { AgentExecutionErrorCodes } from "../Xml/AgentXmlStatus.js";

export const AgentToolProcessResponseEnvelope = {
  Type: "tool_result",
  Version: 1,
} as const;

export type AgentToolProcessResponseType = typeof AgentToolProcessResponseEnvelope.Type;
export type AgentToolProcessResponseVersion = typeof AgentToolProcessResponseEnvelope.Version;

export interface AgentToolProcessEnvelopeIssue {
  pointer: string;
  message: string;
  actual?: unknown;
  expected?: unknown;
}

export type AgentToolProcessEnvelopeValidation =
  | {
      ok: true;
      response: AgentToolProcessResponse;
    }
  | {
      ok: false;
      issues: AgentToolProcessEnvelopeIssue[];
    };

export const AgentToolProcessErrorSchema = z
  .object({
    code: z.enum(AgentExecutionErrorCodes),
    message: z.string().min(1),
    diagnostics: z.array(z.unknown()).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export function readAgentToolProcessError(value: unknown): AgentToolProcessError | undefined {
  const parsed = AgentToolProcessErrorSchema.safeParse(value);
  return parsed.success ? (parsed.data as AgentToolProcessError) : undefined;
}

const AgentToolProcessResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      type: z.literal(AgentToolProcessResponseEnvelope.Type),
      version: z.literal(AgentToolProcessResponseEnvelope.Version),
      ok: z.literal(true),
      result: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal(AgentToolProcessResponseEnvelope.Type),
      version: z.literal(AgentToolProcessResponseEnvelope.Version),
      ok: z.literal(false),
      error: AgentToolProcessErrorSchema,
    })
    .passthrough(),
]);

export function createToolProcessSuccessResponse(result: unknown): AgentToolProcessResponse {
  return {
    type: AgentToolProcessResponseEnvelope.Type,
    version: AgentToolProcessResponseEnvelope.Version,
    ok: true,
    result,
  };
}

export function createToolProcessFailureResponse(error: AgentToolProcessError): AgentToolProcessResponse {
  return {
    type: AgentToolProcessResponseEnvelope.Type,
    version: AgentToolProcessResponseEnvelope.Version,
    ok: false,
    error,
  };
}

export function toolProcessSuccessResult(result: unknown): AgentToolProcessRunResult {
  return {
    response: createToolProcessSuccessResponse(result),
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: null,
  };
}

export function toolProcessFailureResult(error: AgentToolProcessError): AgentToolProcessRunResult {
  return {
    response: createToolProcessFailureResponse(error),
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: null,
  };
}

export function validateToolProcessResponseEnvelope(value: unknown): AgentToolProcessEnvelopeValidation {
  const parsed = AgentToolProcessResponseSchema.safeParse(value);
  return parsed.success
    ? { ok: true, response: parsed.data as AgentToolProcessResponse }
    : {
        ok: false,
        issues: parsed.error.issues.map((issue) => ({
          pointer: zodPathToPointer(issue.path),
          message: issue.message,
        })),
      };
}

function zodPathToPointer(path: PropertyKey[]): string {
  return agentJsonPathToPointer(path.map((part) => (typeof part === "number" ? part : String(part)))) || "/";
}
