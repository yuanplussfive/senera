import { describe, expect, test } from "vitest";
import { projectAgentPiToolResultStatus } from "../../../Source/AgentSystem/Pi/AgentPiToolResultPolicy.js";
import { AgentPiToolResultStatuses } from "../../../Source/AgentSystem/Pi/AgentPiTypes.js";
import {
  AgentToolFailureKinds,
  AgentToolFailureSources,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";

describe("AgentPiToolResultPolicy", () => {
  test("marks structured failures as Pi tool errors", () => {
    expect(
      projectAgentPiToolResultStatus({
        senera: {
          toolName: "WorkspaceReadFile",
          status: AgentPiToolResultStatuses.Failure,
          executionStatus: "completed",
          outputAvailability: "none",
          error: {
            code: AgentExecutionErrorCodes.ToolExecutionError,
            message: "Tool execution failed.",
            kind: AgentToolFailureKinds.Execution,
            source: AgentToolFailureSources.Host,
            retryable: false,
          },
        },
      }),
    ).toEqual({ isError: true });
  });

  test("leaves successful and foreign tool details unchanged", () => {
    expect(
      projectAgentPiToolResultStatus({
        senera: {
          toolName: "WorkspaceReadFile",
          status: AgentPiToolResultStatuses.Success,
          executionStatus: "completed",
          outputAvailability: "complete",
        },
      }),
    ).toBeUndefined();
    expect(projectAgentPiToolResultStatus({ status: AgentPiToolResultStatuses.Failure })).toBeUndefined();
    expect(
      projectAgentPiToolResultStatus({
        senera: {
          toolName: "WorkspaceReadFile",
          status: AgentPiToolResultStatuses.Failure,
          executionStatus: "completed",
          outputAvailability: "none",
        },
      }),
    ).toBeUndefined();
    expect(projectAgentPiToolResultStatus(undefined)).toBeUndefined();
  });

  test("keeps unassessed tool results neutral in Pi", () => {
    expect(
      projectAgentPiToolResultStatus({
        senera: {
          toolName: "ShellCommandTool",
          status: AgentPiToolResultStatuses.Unassessed,
          executionStatus: "completed",
          outputAvailability: "complete",
        },
      }),
    ).toBeUndefined();
  });
});
