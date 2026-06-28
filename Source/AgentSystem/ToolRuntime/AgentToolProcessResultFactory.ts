import type {
  AgentToolProcessError,
  AgentToolProcessResponse,
} from "../Types/ToolRuntimeTypes.js";
import { createToolProcessFailureResponse } from "./AgentToolProcessEnvelope.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessTypes.js";

export function failedToolProcessResult(
  error: AgentToolProcessError,
): AgentToolProcessRunResult {
  return {
    response: createToolProcessFailureResponse(error),
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: null,
  };
}

export function failedToolProcessResponse(
  error: AgentToolProcessError,
): AgentToolProcessResponse {
  return createToolProcessFailureResponse(error);
}
