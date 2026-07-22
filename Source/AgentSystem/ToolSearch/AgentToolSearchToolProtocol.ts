import { z } from "zod";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { ToolSearchToolName } from "./AgentToolSearchRuntimeTypes.js";

export const ToolSearchArgumentsSchema = z
  .object({
    query: z.preprocess(coerceStringLike, z.string().trim().min(1)),
    preferredSources: z.array(z.string().trim().min(1)).min(1).optional(),
    includeLoaded: z.preprocess(coerceBooleanLike, z.boolean()).optional(),
  })
  .strict();

export type ToolSearchArguments = z.infer<typeof ToolSearchArgumentsSchema>;

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

export function invalidToolSearchArgumentsResult(
  issues: z.ZodError<ToolSearchArguments>["issues"],
): AgentToolProcessRunResult {
  return toolSearchFailure({
    code: AgentExecutionErrorCodes.InvalidToolArguments,
    message: "ToolSearchTool 参数无效。",
    details: {
      phase: AgentToolProcessErrorPhases.RuntimeExecution,
      issues,
      toolName: ToolSearchToolName,
    },
    diagnostics: issues.map((issue) => ({
      message: issue.message,
      pointer: `/${issue.path.join("/")}`,
      path: issue.path.map((entry) => (typeof entry === "number" ? entry : String(entry))),
    })),
  });
}

export function okToolSearchResult(result: unknown): AgentToolProcessRunResult {
  return toolProcessSuccessResult(result);
}

function toolSearchFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
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
