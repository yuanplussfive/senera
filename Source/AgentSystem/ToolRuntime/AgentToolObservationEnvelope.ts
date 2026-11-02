import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import {
  AgentPiToolObservationProtocol,
  AgentPiToolObservationSourceViewProtocol,
  parseAgentPiToolObservation,
  type AgentPiToolObservation,
} from "../PiShared/AgentPiToolObservationProtocol.js";
import type {
  AgentToolArtifactAvailability,
  AgentToolSourceArtifactReference,
  ExecutedToolCallArtifact,
  ToolArtifactEvidenceRecord,
} from "../Types/ToolRuntimeTypes.js";

export interface AgentToolObservationEnvelopeInput {
  readonly status: AgentPiToolObservation["status"];
  readonly executionStatus: AgentPiToolObservation["execution_status"];
  readonly outputAvailability: AgentPiToolObservation["output_availability"];
  readonly result: unknown;
  readonly error?: AgentPiToolObservation["error"];
  readonly artifact?: ExecutedToolCallArtifact;
  readonly sourceArtifacts?: readonly AgentToolSourceArtifactReference[];
  readonly artifactAvailability?: AgentToolArtifactAvailability;
  /** Single effective allocation from the shared Pi turn-token budget. */
  readonly observationBudgetTokens: number;
}

export interface AgentToolObservationOmission {
  readonly path: string;
  readonly reason: string;
  readonly omitted?: number;
}

export interface AgentToolPressureObservationOptions {
  readonly notice?: string;
  readonly omissions?: readonly AgentToolObservationOmission[];
}

/** An explicitly supplied empty result still owns its result-derived evidence. */
export function readAgentToolObservationEvidence(
  input: AgentToolObservationEnvelopeInput,
): readonly ToolArtifactEvidenceRecord[] {
  return (input.artifact?.evidence ?? []).filter((entry) => input.result === undefined || entry.origin !== "result");
}

export function buildAgentToolObservationMetadata(
  input: AgentToolObservationEnvelopeInput,
  evidence = readAgentToolObservationEvidence(input),
) {
  const refs = evidence.length > 0 ? (input.artifact?.structuredSummary?.retrieval.refs ?? []) : [];
  const evidenceUris = evidence.flatMap((entry) => (typeof entry.evidenceUri === "string" ? [entry.evidenceUri] : []));
  return {
    type: AgentPiToolObservationProtocol.type,
    status: input.status,
    execution_status: input.executionStatus,
    output_availability: input.outputAvailability,
    ...(input.artifact ? { artifact_uri: input.artifact.artifactUri } : {}),
    ...(refs.length > 0 ? { artifact_refs: [...refs] } : {}),
    ...(evidenceUris.length > 0 ? { evidence_uris: evidenceUris } : {}),
    ...(input.sourceArtifacts?.length
      ? {
          source_artifacts: input.sourceArtifacts.map((source) => ({
            artifact_uri: source.artifactUri,
            refs: [...source.refs],
          })),
        }
      : {}),
  };
}

/** Transport diagnostics remain payload, separately from the mandatory failure identity. */
export function splitAgentToolFailureFeedback(failure: AgentPiToolObservation["error"]): {
  readonly error?: AgentPiToolObservation["error"];
  readonly detail?: Record<string, unknown>;
} {
  if (!failure) return {};
  if (!("details" in failure) && !("diagnostics" in failure)) return { error: failure };
  const { details, diagnostics, ...error } = failure;
  const detail = {
    ...(details === undefined ? {} : { details }),
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
  return { error, ...(Object.keys(detail).length > 0 ? { detail } : {}) };
}

/** No result rendering, summarization or evidence body is needed to preserve an outcome. */
export function createAgentToolPressureObservation(
  input: AgentToolObservationEnvelopeInput,
  tokens: AgentTokenProjector,
  reason: string,
  options: AgentToolPressureObservationOptions = {},
): AgentPiToolObservation {
  const common = buildAgentToolObservationMetadata(input);
  let error = splitAgentToolFailureFeedback(input.error).error;
  const omissions = [...(options.omissions ?? []), { path: "/detail", reason }];
  const build = (): AgentPiToolObservation =>
    parseAgentPiToolObservation({
      ...common,
      ...(error ? { error } : {}),
      compression_method: "mechanical",
      observation_view: {
        type: AgentPiToolObservationSourceViewProtocol.type,
        complete: false,
        omission_count: omissions.length,
        omissions,
        ...(input.artifactAvailability === undefined ? {} : { artifact_availability: input.artifactAvailability }),
      },
      detail: {
        notice:
          options.notice ??
          (input.artifact
            ? "Context pressure: the complete tool result remains available from its artifact; Pi will compact the conversation before the next model request."
            : "Context pressure: the tool result was bounded for this turn; Pi will compact the conversation before the next model request."),
      },
    });
  const budget = Number.isFinite(input.observationBudgetTokens)
    ? Math.max(0, Math.floor(input.observationBudgetTokens))
    : 0;
  if (!error || tokens.countJson(build()) <= budget) return build();

  const sourceMessage = error.message;
  if (!omissions.some((entry) => entry.path === "/error/message")) {
    omissions.push({ path: "/error/message", reason: "deferred_content" });
  }
  let best = tokens.previewText(sourceMessage, 1).text;
  let lower = 1;
  let upper = budget;
  while (lower <= upper) {
    const limit = Math.floor((lower + upper) / 2);
    error = { ...error, message: tokens.previewText(sourceMessage, limit).text };
    if (tokens.countJson(build()) <= budget) {
      best = error.message;
      lower = limit + 1;
    } else upper = limit - 1;
  }
  // If the mandatory protocol itself exceeds the allocation, keep its minimum
  // valid form so Pi can reach its native compaction boundary.
  error = { ...error, message: best };
  return build();
}
