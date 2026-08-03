import { describe, expect, test } from "vitest";
import { assessToolSearchEpisode } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchEpisodeScorer.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import { createToolProcessSuccessResponse } from "../../../Source/AgentSystem/ToolRuntime/AgentToolProcessEnvelope.js";
import { ToolResultAssessmentPolicies } from "../../../Source/AgentSystem/Types/AgentToolContractTypes.js";
import {
  AgentToolFailureSources,
  createAgentToolExecutionOutcome,
  normalizeAgentToolProcessResult,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultOutcome.js";

describe("tool search episode outcome", () => {
  test("treats a nonzero process exit as a failed tool call", () => {
    const assessment = assessToolSearchEpisode([toolResult({ exitCode: 7, stderr: "command failed" })]);

    expect(assessment.calls).toEqual([
      expect.objectContaining({
        status: "failure",
        errorCode: AgentExecutionErrorCodes.ToolProcessExited,
        error: expect.stringContaining("exit code 7"),
      }),
    ]);
    expect(assessment.finalOutcome.toolExecutionSucceeded).toBe(false);
    expect(assessment.outcome).toBe("failure");
  });

  test("does not reinterpret stderr from a successful process as failure", () => {
    const assessment = assessToolSearchEpisode([toolResult({ exitCode: 0, stderr: "informational warning" })]);

    expect(assessment.calls).toEqual([
      expect.objectContaining({
        status: "success",
        errorCode: "",
        error: "",
      }),
    ]);
    expect(assessment.finalOutcome.toolExecutionSucceeded).toBe(true);
    expect(assessment.outcome).toBe("success");
  });
});

function toolResult(process: { exitCode: number; stderr: string }): ExecutedToolCallResult {
  const execution = normalizeAgentToolProcessResult(
    {
      response: createToolProcessSuccessResponse({ value: "usable" }),
      stdout: "",
      ...process,
      signal: null,
    },
    ToolResultAssessmentPolicies.ProcessExit,
  );
  return {
    callId: "call-outcome",
    name: "OutcomeTool",
    arguments: {},
    process: { ...process, signal: null, stdout: "" },
    result: { value: "usable" },
    outcome: createAgentToolExecutionOutcome(
      execution,
      AgentToolFailureSources.Host,
      ToolResultAssessmentPolicies.ProcessExit,
    ),
    artifact: {
      artifactId: "art_outcome",
      artifactUri: "senera://artifact/art_outcome",
      artifactPath: "artifacts/outcome",
      relativePath: "artifacts/outcome",
      manifestPath: "artifacts/outcome/manifest.json",
      files: {},
      summary: "usable evidence",
      evidence: [],
      delta: [],
    },
  };
}
