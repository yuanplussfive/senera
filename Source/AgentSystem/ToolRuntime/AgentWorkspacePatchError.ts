import type { AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessTypes.js";

export interface WorkspacePatchFailureInput {
  code: (typeof AgentExecutionErrorCodes)[keyof typeof AgentExecutionErrorCodes];
  message: string;
  diagnostics?: AgentSourceDiagnostic[];
  details?: NonNullable<AgentToolProcessRunResult["response"]["error"]>["details"];
}

export class WorkspaceApplyPatchError extends Error {
  readonly pointer: string;
  readonly suggestion?: string;

  constructor(input: { message: string; pointer: string; suggestion?: string }) {
    super(input.message);
    this.name = "WorkspaceApplyPatchError";
    this.pointer = input.pointer;
    this.suggestion = input.suggestion;
  }

  toFailureInput(toolName: string): WorkspacePatchFailureInput {
    return {
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: this.message,
      diagnostics: [
        {
          message: this.message,
          pointer: this.pointer,
          suggestion: this.suggestion,
        },
      ],
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName,
      },
    };
  }
}
