import { z } from "zod";
import { AgentToolProcessProtocol } from "./AgentToolProcessProtocol.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "./AgentXmlStatus.js";
import { ToolSearchToolName } from "./AgentToolSearchRuntimeTypes.js";

export const ToolSearchArgumentsSchema = z
  .object({
    query: z.preprocess(coerceStringLike, z.string().trim().min(1)),
    includeLoaded: z.preprocess(coerceBooleanLike, z.boolean()).optional(),
  })
  .strict();

export type ToolSearchArguments = z.infer<typeof ToolSearchArgumentsSchema>;

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
      path: issue.path.map((entry) => typeof entry === "number" ? entry : String(entry)),
    })),
  });
}

export function okToolSearchResult(result: unknown): AgentToolProcessRunResult {
  return {
    response: {
      protocol: AgentToolProcessProtocol,
      ok: true,
      result,
    },
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: null,
  };
}

function toolSearchFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return {
    response: {
      protocol: AgentToolProcessProtocol,
      ok: false,
      error,
    },
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: null,
  };
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
