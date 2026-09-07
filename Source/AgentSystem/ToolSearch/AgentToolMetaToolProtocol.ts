import { z } from "zod";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import type { AgentToolMetaToolName } from "./AgentToolSearchRuntimeTypes.js";

export const AgentToolDiscoveryProtocol = defineSeneraProtocol("tool_discovery", 2);

export function createAgentToolDiscoveryResult<T extends Record<string, unknown>>(
  fields: T,
): T & { type: typeof AgentToolDiscoveryProtocol.type } {
  return { ...fields, type: AgentToolDiscoveryProtocol.type };
}

export const ToolSearchArgumentsSchema = z
  .object({
    query: z.preprocess(coerceStringLike, z.string().trim().min(1)),
    preferredSources: z.array(z.string().trim().min(1)).min(1).optional(),
    includeLoaded: z.preprocess(coerceBooleanLike, z.boolean()).optional(),
  })
  .strict();

export const ToolDescribeArgumentsSchema = z
  .object({
    tools: z.array(z.string().trim().min(1)).min(1).max(12),
    catalogRevision: z.string().trim().min(1).optional(),
  })
  .strict();

export const ToolLoadArgumentsSchema = z
  .object({
    tools: z.array(z.string().trim().min(1)).min(1).max(12),
    catalogRevision: z.string().trim().min(1).optional(),
  })
  .strict();

export const ToolUnloadArgumentsSchema = z
  .object({
    tools: z.array(z.string().trim().min(1)).min(1).max(12),
  })
  .strict();

export type ToolSearchArguments = z.infer<typeof ToolSearchArgumentsSchema>;
export type ToolDescribeArguments = z.infer<typeof ToolDescribeArgumentsSchema>;
export type ToolLoadArguments = z.infer<typeof ToolLoadArgumentsSchema>;
export type ToolUnloadArguments = z.infer<typeof ToolUnloadArgumentsSchema>;

export function createToolSearchArgumentsSchema(sourceIds: readonly string[]) {
  const knownSources = new Set(sourceIds);
  return ToolSearchArgumentsSchema.superRefine((arguments_, context) => {
    const seen = new Set<string>();
    arguments_.preferredSources?.forEach((sourceId, index) => {
      if (seen.has(sourceId)) {
        context.addIssue({
          code: "custom",
          path: ["preferredSources", index],
          message: `Tool discovery source ${sourceId} may only be selected once.`,
        });
      } else if (!knownSources.has(sourceId)) {
        context.addIssue({
          code: "custom",
          path: ["preferredSources", index],
          message: `Unknown tool discovery source: ${sourceId}.`,
        });
      }
      seen.add(sourceId);
    });
  });
}

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

function coerceBooleanLike(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return value;
}
