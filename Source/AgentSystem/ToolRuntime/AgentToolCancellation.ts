import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import { createToolProcessFailureResponse } from "./AgentToolProcessEnvelope.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "../Xml/AgentXmlStatus.js";
import { readAbortMessage } from "../Core/AgentCancellation.js";

export function cancelledToolProcessResult(input: {
  signal?: AbortSignal;
  toolName?: string;
  phase?: string;
  command?: string;
  cwd?: string;
}): AgentToolProcessRunResult {
  return {
    response: createToolProcessFailureResponse({
      code: AgentExecutionErrorCodes.ToolProcessCancelled,
      message: readAbortMessage(input.signal),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName: input.toolName,
        cancellationPhase: input.phase,
        command: input.command,
        cwd: input.cwd,
      },
    }),
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: "SIGTERM",
  };
}
