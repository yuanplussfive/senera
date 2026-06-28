import type {
  ExecutedToolCallArtifact,
  ExecutedToolCallResult,
  ToolArtifactEvidenceRecord,
} from "../Types/ToolRuntimeTypes.js";
import type {
  AgentToolSearchEpisodeCall,
  AgentToolSearchFinalOutcome,
} from "./AgentToolSearchMemory.js";

export interface AgentToolSearchEpisodeAssessment {
  calls: AgentToolSearchEpisodeCall[];
  outcome: "success" | "failure" | "unknown";
  finalScore: number;
  finalOutcome: AgentToolSearchFinalOutcome;
}

export function assessToolSearchEpisode(
  results: readonly ExecutedToolCallResult[],
): AgentToolSearchEpisodeAssessment {
  const calls = results.map((result) => assessToolCall(result));
  const finalOutcome = {
    toolExecutionSucceeded: calls.length > 0 && calls.every((call) => call.status !== "failure"),
    producedEvidence: calls.some((call) => call.hasEvidence),
    producedArtifact: calls.some((call) => call.hasArtifact),
    changedWorkspace: calls.some((call) => call.hasWorkspaceChanges),
  };
  const producedUsefulOutcome = finalOutcome.producedEvidence
    || finalOutcome.producedArtifact
    || finalOutcome.changedWorkspace;
  const succeeded = finalOutcome.toolExecutionSucceeded && producedUsefulOutcome;
  return {
    calls,
    outcome: succeeded ? "success" : "failure",
    finalScore: succeeded ? 1 : 0,
    finalOutcome,
  };
}

function assessToolCall(result: ExecutedToolCallResult): AgentToolSearchEpisodeCall {
  const toolError = readToolError(result);
  const artifact = result.artifact;
  const evidenceUris = readEvidenceUris(artifact?.evidence ?? []);
  const evidenceKinds = readEvidenceKinds(artifact?.evidence ?? []);
  const artifactUris = artifact?.artifactUri ? [artifact.artifactUri] : [];
  const hasWorkspaceChanges = hasChangedWorkspace(artifact);
  const status = toolError.message
    ? "failure"
    : isEmptyToolResult(result)
      ? "empty"
      : "success";
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
    errorCode: toolError.code,
    error: toolError.message,
    score: status === "success" && producedUsefulOutcome ? 1 : 0,
  };
}

function readToolError(result: ExecutedToolCallResult): { code: string; message: string } {
  const protocolError = readErrorField(result.result);
  if (protocolError) {
    return protocolError;
  }

  const message = [
    result.process.stderr,
  ].find((value) => value.trim().length > 0)?.trim() ?? "";
  return { code: "", message };
}

function readErrorField(value: unknown): { code: string; message: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const error = (value as Record<string, unknown>).error;
  if (typeof error === "string" && error.trim().length > 0) {
    return { code: "", message: error.trim() };
  }
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code.trim() : "";
  const message = typeof record.message === "string" ? record.message.trim() : "";
  return code || message ? { code, message } : undefined;
}

function readEvidenceUris(evidence: readonly ToolArtifactEvidenceRecord[]): string[] {
  return [...new Set(evidence.map((entry) => entry.evidenceUri).filter(Boolean))].sort();
}

function readEvidenceKinds(evidence: readonly ToolArtifactEvidenceRecord[]): string[] {
  return [...new Set(evidence.map((entry) => entry.kind).filter(Boolean))].sort();
}

function hasChangedWorkspace(artifact: ExecutedToolCallArtifact | undefined): boolean {
  return Boolean(
    artifact?.workspace?.changes.some((change) => change.status !== "unchanged")
    || artifact?.delta.some((entry) => entry.status !== "unchanged"),
  );
}

function isEmptyToolResult(result: ExecutedToolCallResult): boolean {
  return !result.artifact
    && (result.result === undefined
      || result.result === null
      || (Array.isArray(result.result) && result.result.length === 0)
      || (typeof result.result === "object"
        && !Array.isArray(result.result)
        && Object.keys(result.result as Record<string, unknown>).length === 0));
}
