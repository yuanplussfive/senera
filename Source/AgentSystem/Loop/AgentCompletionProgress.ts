import type { ActionPlanInput } from "../BamlClient/baml_client/types.js";
import type { AgentCompletionProgressAssessment } from "./AgentCompletionGateTypes.js";
import { uniqueStrings } from "./AgentCompletionUtils.js";

export function assessCompletionProgress(input: ActionPlanInput): AgentCompletionProgressAssessment {
  const calls = input.runState.calls.map((call) => ({
    step: call.step,
    toolName: call.toolName,
    status: call.status,
    resultKind: call.resultKind,
    artifactUri: call.artifactUri,
    evidenceUris: call.evidenceUris,
    argumentsPreview: call.argumentsPreview,
    error: call.error,
  }));
  return {
    stalled: input.runState.progress.stalled,
    repeatedCalls: input.runState.warnings,
    nonEvidenceCalls: calls.filter((call) => call.evidenceUris.length === 0),
    failedCalls: calls.filter((call) => call.status === "Failure"),
  };
}

export function completionRequirementBlockers(progress: AgentCompletionProgressAssessment): string[] {
  return uniqueStrings([
    ...(progress.stalled ? ["no new verified evidence after recent tool calls"] : []),
    ...progress.repeatedCalls.map((warning) =>
      `${warning.toolName} repeated ${warning.count} times`),
    ...progress.failedCalls.map((call) =>
      `${call.toolName} failed${call.error ? `: ${call.error}` : ""}`),
    ...progress.nonEvidenceCalls.map((call) =>
      `${call.toolName} produced no verified evidence${call.resultKind ? ` (${call.resultKind})` : ""}`),
  ]);
}
