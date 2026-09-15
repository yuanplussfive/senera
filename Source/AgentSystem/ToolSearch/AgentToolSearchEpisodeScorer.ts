import type {
  ExecutedToolCallArtifact,
  ExecutedToolCallResult,
  ToolArtifactEvidenceRecord,
} from "../Types/ToolRuntimeTypes.js";
import type { AgentToolSearchEpisodeCall, AgentToolSearchFinalOutcome } from "./AgentToolSearchMemory.js";
import { readAgentToolFailure } from "../ToolRuntime/AgentToolResultOutcome.js";

export interface AgentToolSearchEpisodeAssessment {
  calls: AgentToolSearchEpisodeCall[];
  outcome: "success" | "failure" | "unknown";
  finalScore: number;
  finalOutcome: AgentToolSearchFinalOutcome;
}

export function assessToolSearchEpisode(results: readonly ExecutedToolCallResult[]): AgentToolSearchEpisodeAssessment {
  const calls = results.map((result) => assessToolCall(result));
  const finalOutcome = {
    toolExecutionSucceeded: calls.length > 0 && calls.every((call) => call.status === "success"),
    producedEvidence: calls.some((call) => call.hasEvidence),
    producedArtifact: calls.some((call) => call.hasArtifact),
    changedWorkspace: calls.some((call) => call.hasWorkspaceChanges),
  };
  const producedUsefulOutcome =
    finalOutcome.producedEvidence || finalOutcome.producedArtifact || finalOutcome.changedWorkspace;
  const succeeded = finalOutcome.toolExecutionSucceeded && producedUsefulOutcome;
  return {
    calls,
    outcome: succeeded ? "success" : "failure",
    finalScore: succeeded ? 1 : 0,
    finalOutcome,
  };
}

function assessToolCall(result: ExecutedToolCallResult): AgentToolSearchEpisodeCall {
  const toolError = readAgentToolFailure(result.outcome);
  const artifact = result.artifact;
  const evidenceUris = readEvidenceUris(artifact?.evidence ?? []);
  const evidenceKinds = readEvidenceKinds(artifact?.evidence ?? []);
  const artifactUris = artifact?.artifactUri ? [artifact.artifactUri] : [];
  const hasWorkspaceChanges = hasChangedWorkspace(artifact);
  const status = toolError ? "failure" : isEmptyToolResult(result) ? "empty" : "success";
  const producedUsefulOutcome = Boolean(artifact) || evidenceUris.length > 0 || hasWorkspaceChanges;

  return {
    toolName: result.name,
    argumentKeys: Object.keys(result.arguments).sort(),
    evidenceKinds,
    status,
    evidenceUris,
    artifactUris,
    hasArtifact: Boolean(artifact),
    hasEvidence: evidenceUris.length > 0,
    hasWorkspaceChanges,
    errorCode: toolError?.code ?? "",
    error: toolError?.message ?? "",
    failureKind: toolError?.kind,
    failureSource: toolError?.source,
    retryable: toolError?.retryable,
    score: status === "success" && producedUsefulOutcome ? 1 : 0,
  };
}

export function isGroundedSuccessfulToolSearchCall(call: AgentToolSearchEpisodeCall): boolean {
  return call.status === "success" && (call.hasEvidence || call.hasArtifact || call.hasWorkspaceChanges);
}

function readEvidenceUris(evidence: readonly ToolArtifactEvidenceRecord[]): string[] {
  return [...new Set(evidence.map((entry) => entry.evidenceUri).filter(Boolean))].sort();
}

function readEvidenceKinds(evidence: readonly ToolArtifactEvidenceRecord[]): string[] {
  return [...new Set(evidence.map((entry) => entry.kind).filter(Boolean))].sort();
}

function hasChangedWorkspace(artifact: ExecutedToolCallArtifact | undefined): boolean {
  return Boolean(
    artifact?.workspace?.changes.some((change) => change.status !== "unchanged") ||
    artifact?.delta.some((entry) => entry.status !== "unchanged"),
  );
}

function isEmptyToolResult(result: ExecutedToolCallResult): boolean {
  return (
    !result.artifact &&
    (result.result === undefined ||
      result.result === null ||
      (Array.isArray(result.result) && result.result.length === 0) ||
      (typeof result.result === "object" &&
        !Array.isArray(result.result) &&
        Object.keys(result.result as Record<string, unknown>).length === 0))
  );
}
