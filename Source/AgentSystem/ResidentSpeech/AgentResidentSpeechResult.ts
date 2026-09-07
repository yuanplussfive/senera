import { z } from "zod";
import {
  AgentInvalidModelToolArgumentsError,
  AgentRequiredModelToolCallError,
} from "../ModelEndpoints/AgentModelFailureMapper.js";
import {
  formatAgentToolContractValidationIssue,
  validateToolContractValue,
} from "../ToolRuntime/AgentToolSignatureArgumentValidator.js";
import type { RegisteredSidecarTool } from "../Types/AgentToolRuntimeTypes.js";
import { AgentPiNativeToolBridgeName } from "../Pi/AgentPiNativeToolBridge.js";

const AgentResidentSpeechResultSchema = z
  .object({
    utterance: z.string().trim().min(1),
  })
  .strict();

const AgentResidentSpeechNativeInvocationSchema = z
  .object({
    tool: z.string().trim().min(1),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();

export function parseAgentResidentSpeechResult(value: unknown, toolName: string): { utterance: string } {
  const parsed = AgentResidentSpeechResultSchema.safeParse(value);
  if (!parsed.success) throw new AgentInvalidModelToolArgumentsError(toolName);
  return parsed.data;
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
  return parseAgentResidentSpeechResult(invocation.data.arguments, contract.name);
}

export function assertAgentResidentSpeechContract(contract: RegisteredSidecarTool): void {
  const properties = contract.inputSchema.properties;
  const utterance =
    properties && typeof properties === "object" && !Array.isArray(properties)
      ? (properties as Record<string, unknown>).utterance
      : undefined;
  if (!utterance || typeof utterance !== "object" || Array.isArray(utterance)) {
    throw new Error(`Resident speech sidecar ${contract.name} must declare the utterance input property.`);
  }
}
