import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  createAgentPiToolObservation,
  readAgentPiToolObservation,
  type AgentPiToolObservation,
} from "../../../Source/AgentSystem/Pi/AgentPiToolObservation.js";
import {
  AgentPiToolObservationSourceViewProtocol,
  type AgentPiToolObservationSourceView,
} from "../../../Source/AgentSystem/PiShared/AgentPiToolObservationProtocol.js";
import { AgentToolResultObservationCompressor } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResultObservationCompressor.js";
import type { ExecutedToolCallResult } from "../../../Source/AgentSystem/Types/ToolRuntimeTypes.js";

export interface PiToolObservationFixtureInput {
  readonly toolName?: string;
  readonly callId?: string;
  readonly batchId?: string;
  readonly status?: AgentPiToolObservation["status"];
  readonly executionStatus?: AgentPiToolObservation["execution_status"];
  readonly outputAvailability?: AgentPiToolObservation["output_availability"];
  readonly summary?: unknown;
  readonly notice?: string;
  readonly error?: unknown;
  readonly failure?: AgentPiToolObservation["error"];
  readonly outcome?: unknown;
  readonly process?: unknown;
  readonly result?: unknown;
  readonly arguments?: unknown;
  readonly artifact?: ExecutedToolCallResult["artifact"];
  readonly sourceArtifacts?: ExecutedToolCallResult["sourceArtifacts"];
  readonly observation_view?: AgentPiToolObservationSourceView;
  readonly detail?: AgentPiToolObservation["detail"];
}

export function createTestToolObservationCompressor(
  options: {
    readonly summarize?: ConstructorParameters<typeof AgentToolResultObservationCompressor>[0]["summarize"];
  } = {},
): AgentToolResultObservationCompressor {
  return new AgentToolResultObservationCompressor({
    model: "test-model",
    summarize: options.summarize ?? (async () => "Summarized test tool result."),
  });
}

export function compilePiToolObservation(overrides: PiToolObservationFixtureInput = {}): AgentPiToolObservation {
  const artifact = overrides.artifact;
  const evidence = artifact?.evidence ?? [];
  const detail =
    overrides.detail ??
    (compact({
      ...(overrides.summary === undefined ? {} : { summary: overrides.summary }),
      ...(overrides.error === undefined ? {} : { error_detail: overrides.error }),
      ...(overrides.process === undefined ? {} : { process: overrides.process }),
      ...(overrides.outcome === undefined ? {} : { outcome: overrides.outcome }),
      ...(overrides.result === undefined ? {} : { result: overrides.result }),
      ...(overrides.arguments === undefined ? {} : { arguments: overrides.arguments }),
      ...(overrides.notice === undefined ? {} : { notice: overrides.notice }),
      evidence: evidence.map((entry) =>
        compact({
          evidence_uri: entry.evidenceUri,
          kind: entry.kind,
          locator: entry.locator,
          display: entry.display,
          label: entry.label,
          source: entry.source,
          confidence: entry.confidence,
          artifact_uri: entry.plannerMemory.artifactUri,
          artifact_refs: entry.plannerMemory.artifactRefs,
          facts: entry.modelSlots,
        }),
      ),
    }) as AgentPiToolObservation["detail"]);
  const retrievalRefs = artifact?.structuredSummary?.retrieval.refs;
  const evidenceUris = evidence.flatMap((entry) => (entry.evidenceUri ? [entry.evidenceUri] : []));
  return createAgentPiToolObservation({
    status: overrides.status ?? "success",
    execution_status: overrides.executionStatus ?? "completed",
    output_availability: overrides.outputAvailability ?? "complete",
    ...(artifact ? { artifact_uri: artifact.artifactUri } : {}),
    ...(retrievalRefs?.length ? { artifact_refs: [...retrievalRefs] } : {}),
    ...(evidenceUris.length ? { evidence_uris: evidenceUris } : {}),
    ...(overrides.failure ? { error: overrides.failure } : {}),
    ...(overrides.sourceArtifacts?.length
      ? {
          source_artifacts: overrides.sourceArtifacts.map((source) => ({
            artifact_uri: source.artifactUri,
            refs: [...source.refs],
          })),
        }
      : {}),
    ...(overrides.observation_view ? { observation_view: overrides.observation_view } : {}),
    detail,
  });
}

export function boundPiToolObservationView(
  observation: AgentPiToolObservation,
  patch: Partial<AgentPiToolObservationSourceView> = {},
): AgentPiToolObservationSourceView {
  return {
    type: AgentPiToolObservationSourceViewProtocol.type,
    complete: true,
    omission_count: 0,
    omissions: [],
    ...observation.observation_view,
    ...patch,
  };
}

export function piToolResultMessage(
  observation: AgentPiToolObservation,
  identity: { toolCallId: string; toolName: string } = { toolCallId: "call-1", toolName: "TestTool" },
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: identity.toolCallId,
    toolName: identity.toolName,
    content: [{ type: "text", text: JSON.stringify(observation) }],
    isError: observation.status === "failure",
    timestamp: Date.now(),
  } as AgentMessage;
}

export function parseFixtureObservation(value: unknown): AgentPiToolObservation {
  const parsed = readAgentPiToolObservation(JSON.stringify(value));
  if (!parsed) throw new Error("Fixture contains an invalid Pi tool observation.");
  return parsed;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
