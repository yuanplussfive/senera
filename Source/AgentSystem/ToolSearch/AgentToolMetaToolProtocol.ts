import { z } from "zod";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import type { AgentToolMetaToolName } from "./AgentToolSearchRuntimeTypes.js";

export const AgentToolDiscoveryProtocol = defineSeneraProtocol("tool_discovery", 5);
export const AgentToolDescriptionProtocol = defineSeneraProtocol("tool_description", 2);

export const AgentToolCatalogStatuses = {
  Current: "current",
  Stale: "stale",
} as const;

export type AgentToolCatalogStatus = (typeof AgentToolCatalogStatuses)[keyof typeof AgentToolCatalogStatuses];

export function createAgentToolDiscoveryResult<T extends object>(
  fields: T,
): T & { type: typeof AgentToolDiscoveryProtocol.type } {
  return { ...fields, type: AgentToolDiscoveryProtocol.type };
}

export function createAgentToolDescriptionResult<T extends object>(
  fields: T,
): T & { type: typeof AgentToolDescriptionProtocol.type } {
  return { ...fields, type: AgentToolDescriptionProtocol.type };
}

export const ToolSearchArgumentsSchema = z
  .object({
    query: z.preprocess(coerceStringLike, z.string().trim().min(1)),
  })
  .strict();

export interface ToolSearchArguments {
  readonly query: string;
}

export type ResolvedToolSearchArguments = z.output<typeof ToolSearchArgumentsSchema>;

const ToolMutationArgumentsSchema = z
  .object({
    tools: z.array(z.string().trim().min(1)).min(1).max(12),
    catalogRevision: z.string().trim().min(1).optional(),
  })
  .strict();

export const ToolDescribeArgumentsSchema = z
  .object({ tools: z.array(z.string().trim().min(1)).min(1).max(12) })
  .strict();
export const ToolLoadArgumentsSchema = ToolMutationArgumentsSchema;
export const ToolUnloadArgumentsSchema = ToolMutationArgumentsSchema;

export type ToolDescribeArguments = z.infer<typeof ToolDescribeArgumentsSchema>;
export type ToolLoadArguments = z.infer<typeof ToolLoadArgumentsSchema>;
export type ToolUnloadArguments = z.infer<typeof ToolUnloadArgumentsSchema>;

export function invalidToolMetaArgumentsResult(
  toolName: AgentToolMetaToolName,
  issues: readonly z.ZodIssue[],
): AgentToolProcessRunResult {
  return toolProcessFailureResult({
    code: AgentExecutionErrorCodes.InvalidToolArguments,
    message: `${toolName} 参数无效。`,
    details: {
      phase: AgentToolProcessErrorPhases.RuntimeExecution,
      issues,
      toolName,
    },
    diagnostics: issues.map((issue) => ({
      message: issue.message,
      pointer: `/${issue.path.join("/")}`,
      path: issue.path.map((entry) => (typeof entry === "number" ? entry : String(entry))),
    })),
  });
}

export function okToolMetaResult(result: unknown): AgentToolProcessRunResult {
  return toolProcessSuccessResult(result);
}

function coerceStringLike(value: unknown): unknown {
  return typeof value === "number" || typeof value === "boolean" ? String(value) : value;
}
