import { describe, expect, test } from "vitest";
import {
  createToolProcessFailureResponse,
  createToolProcessSuccessResponse,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolProcessEnvelope.js";
import type { AgentToolProcessResponse } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { ToolResultAssessmentPolicies } from "../../../Source/AgentSystem/Types/AgentToolContractTypes.js";
import {
  AgentToolExecutionOutcomeSchema,
  AgentToolFailureSources,
  AgentToolSuccessOutcome,
  createAgentToolExecutionOutcome,
  normalizeAgentToolProcessResult,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";

describe("tool execution outcome", () => {
  test("does not infer execution failure from business result fields", () => {
    const execution = processResult(createToolProcessSuccessResponse({ error: { message: "domain result" } }));
    const normalized = normalizeAgentToolProcessResult(execution, ToolResultAssessmentPolicies.ProcessExit);

    expect(normalized.response.ok).toBe(true);
    expect(
      createAgentToolExecutionOutcome(
        normalized,
        AgentToolFailureSources.Host,
        ToolResultAssessmentPolicies.ProcessExit,
      ),
    ).toEqual(AgentToolSuccessOutcome);
  });

  test.each([undefined, null, "", [], {}])("keeps an empty payload successful", (result) => {
    const execution = processResult(createToolProcessSuccessResponse(result));

    expect(
      createAgentToolExecutionOutcome(
        execution,
        AgentToolFailureSources.Host,
        ToolResultAssessmentPolicies.ProcessExit,
      ),
    ).toEqual(AgentToolSuccessOutcome);
  });

  test("normalizes a nonzero exit when the tool delegates assessment to process semantics", () => {
    const execution = normalizeAgentToolProcessResult(
      processResult(createToolProcessSuccessResponse({ partial: true }), {
        exitCode: 7,
        stderr: "command failed",
      }),
      ToolResultAssessmentPolicies.ProcessExit,
    );
    const outcome = createAgentToolExecutionOutcome(
      execution,
      AgentToolFailureSources.Host,
      ToolResultAssessmentPolicies.ProcessExit,
    );

    expect(outcome).toMatchObject({
      execution: { status: "completed" },
      assessment: {
        status: "failure",
        error: {
          code: AgentExecutionErrorCodes.ToolProcessExited,
          kind: "process_exit",
          source: "process",
          retryable: false,
          details: { exitCode: 7 },
        },
      },
      output: { availability: "partial" },
    });
    expect(AgentToolExecutionOutcomeSchema.parse(outcome)).toEqual(outcome);
  });

  test("passes through nonzero exits without declaring success or failure for unassessed tools", () => {
    const execution = normalizeAgentToolProcessResult(
      processResult(createToolProcessSuccessResponse({ partial: true }), {
        exitCode: 7,
        stderr: "command reported a nonzero exit",
      }),
      ToolResultAssessmentPolicies.Unassessed,
    );

    expect(execution.response.ok).toBe(true);
    expect(
      createAgentToolExecutionOutcome(execution, AgentToolFailureSources.Host, ToolResultAssessmentPolicies.Unassessed),
    ).toEqual({
      execution: { status: "completed" },
      assessment: { status: "unassessed" },
      output: { availability: "complete" },
    });
  });

  test("normalizes an unexpected process signal without treating it as user cancellation", () => {
    const execution = normalizeAgentToolProcessResult(
      processResult(createToolProcessSuccessResponse(undefined), { signal: "SIGKILL" }),
      ToolResultAssessmentPolicies.ProcessExit,
    );

    expect(
      createAgentToolExecutionOutcome(
        execution,
        AgentToolFailureSources.Host,
        ToolResultAssessmentPolicies.ProcessExit,
      ),
    ).toMatchObject({
      execution: { status: "completed" },
      assessment: {
        status: "failure",
        error: {
          code: AgentExecutionErrorCodes.ToolProcessSignalled,
          kind: "process_signal",
          source: "process",
          retryable: false,
        },
      },
    });
  });

  test("preserves timeout semantics independently from runtime source and assessment policy", () => {
    const execution = processResult(
      createToolProcessFailureResponse({
        code: AgentExecutionErrorCodes.ToolProcessTimeout,
        message: "request timed out",
        details: { timeoutMs: 30_000 },
      }),
    );

    expect(
      createAgentToolExecutionOutcome(execution, AgentToolFailureSources.Mcp, ToolResultAssessmentPolicies.Unassessed),
    ).toMatchObject({
      execution: { status: "timed_out" },
      assessment: {
        status: "failure",
        error: {
          kind: "timeout",
          source: "mcp",
          retryable: true,
          details: { timeoutMs: 30_000 },
        },
      },
      output: { availability: "none" },
    });
  });

  test("keeps cancellation distinct from timeout and disables automatic retry", () => {
    const execution = processResult(
      createToolProcessFailureResponse({
        code: AgentExecutionErrorCodes.ToolProcessCancelled,
        message: "cancelled by user",
      }),
    );

    expect(
      createAgentToolExecutionOutcome(
        execution,
        AgentToolFailureSources.Host,
        ToolResultAssessmentPolicies.ProcessExit,
      ),
    ).toMatchObject({
      execution: { status: "cancelled" },
      assessment: {
        status: "failure",
        error: {
          kind: "cancelled",
          source: "host",
          retryable: false,
        },
      },
    });
  });
});

function processResult(
  response: AgentToolProcessResponse,
  overrides: Partial<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }> = {},
) {
  return {
    response,
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
    ...overrides,
  };
}
