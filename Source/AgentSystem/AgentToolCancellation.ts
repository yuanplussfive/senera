import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import { AgentToolProcessProtocol } from "./AgentToolProcessProtocol.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "./AgentXmlStatus.js";
import { readAbortMessage } from "./AgentCancellation.js";

export function cancelledToolProcessResult(input: {
  signal?: AbortSignal;
  toolName?: string;
  phase?: string;
  command?: string;
  cwd?: string;
}): AgentToolProcessRunResult {
  return {
    response: {
      protocol: AgentToolProcessProtocol,
      ok: false,
      error: {
        code: AgentExecutionErrorCodes.ToolProcessCancelled,
        message: readAbortMessage(input.signal),
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
          toolName: input.toolName,
          cancellationPhase: input.phase,
          command: input.command,
          cwd: input.cwd,
        },
      },
    },
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: "SIGTERM",
  };
}
