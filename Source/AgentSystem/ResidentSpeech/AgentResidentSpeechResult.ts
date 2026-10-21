import { z } from "zod";
import {
  AgentInvalidModelToolArgumentsError,
  AgentRequiredModelToolCallError,
} from "../ModelEndpoints/AgentModelFailureMapper.js";
import {
  formatAgentToolContractValidationIssue,
  validateToolContractValue,
} from "../ToolRuntime/AgentToolSignatureArgumentValidator.js";
import { projectAgentSidecarToolResultBody } from "../ToolRuntime/AgentSidecarToolResultProjection.js";
import type { RegisteredSidecarTool } from "../Types/AgentToolRuntimeTypes.js";
import { AgentPiNativeToolBridgeName } from "../Pi/AgentPiNativeToolBridge.js";

const AgentResidentSpeechVisibleTextSchema = z.string().trim().min(1);

const AgentResidentSpeechNativeInvocationSchema = z
  .object({
    tool: z.string().trim().min(1),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();

export function parseAgentResidentSpeechResult(value: unknown, contract: RegisteredSidecarTool): { utterance: string } {
  let body: unknown;
  try {
    body = projectAgentSidecarToolResultBody(contract, value);
  } catch (error) {
    throw new AgentInvalidModelToolArgumentsError(contract.name, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
  const parsed = AgentResidentSpeechVisibleTextSchema.safeParse(body);
  if (!parsed.success) {
    throw new AgentInvalidModelToolArgumentsError(
      contract.name,
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "result"}: ${issue.message}`),
    );
  }
  return { utterance: parsed.data };
}

export function parseAgentResidentSpeechNativeResult(
  value: unknown,
  contract: RegisteredSidecarTool,
): { utterance: string } {
  const invocation = AgentResidentSpeechNativeInvocationSchema.safeParse(value);
  if (!invocation.success) {
    throw new AgentInvalidModelToolArgumentsError(
      AgentPiNativeToolBridgeName,
      invocation.error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`),
    );
  }
  if (invocation.data.tool !== contract.name) {
    throw new AgentRequiredModelToolCallError(contract.name, [invocation.data.tool]);
  }
  const issues = validateToolContractValue({ schema: contract.inputSchema, value: invocation.data.arguments });
  if (issues.length > 0) {
    throw new AgentInvalidModelToolArgumentsError(
      contract.name,
      issues.map((issue) => formatAgentToolContractValidationIssue(issue, "arguments")),
    );
  }
  return parseAgentResidentSpeechResult(invocation.data.arguments, contract);
}
