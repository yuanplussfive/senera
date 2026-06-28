import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessRunner.js";
import { toolProcessFailureResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import { PatchApplyError } from "./AgentPatchApplyTypes.js";

export function normalizePatchError(error: unknown): {
  message: string;
  diagnostics: string[];
  pointer: string;
} {
  if (error instanceof PatchApplyError) {
    return {
      message: error.message,
      diagnostics: error.diagnostics,
      pointer: error.pointer,
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    diagnostics: [error instanceof Error ? error.message : String(error)],
    pointer: "/operations",
  };
}

export function patchFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}
