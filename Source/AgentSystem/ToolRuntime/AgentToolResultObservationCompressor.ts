import { tmpdir } from "node:os";
import path from "node:path";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import { projectAgentToolResultSummaryForObservation } from "../Artifacts/AgentToolResultSummaryCompiler.js";
import {
  AgentPiToolObservationProtocol,
  parseAgentPiToolObservation,
  type AgentPiToolObservation,
} from "../Pi/AgentPiToolObservation.js";
import { AgentToolObservationContentPipeline } from "./AgentToolObservationContentPipeline.js";
import { AgentPiToolObservationSourceViewProtocol } from "../PiShared/AgentPiToolObservationProtocol.js";
import type {
  ToolArtifactEvidenceRecord,
  ExecutedToolCallArtifact,
  AgentToolSourceArtifactReference,
} from "../Types/ToolRuntimeTypes.js";

export type AgentToolObservationCompressionMethod = "verbatim" | "mechanical" | "llm";

export interface AgentToolObservationSummaryRequest {
  /** Stable Pi call identity used to correlate the background summary request. */
  readonly requestId?: string;
  readonly systemPrompt: string;
  readonly currentUserMessage: string;
  readonly toolName: string;
  readonly arguments: unknown;
  readonly feedback: unknown;
  readonly artifactUri?: string;
  readonly evidenceUris: readonly string[];
  readonly tokenBudget: number;
  readonly signal?: AbortSignal;
}

export interface AgentToolResultObservationCompressorOptions {
  readonly model: string;
  /** Workspace-owned derived cache for Sift's lossless/lossy source stash. */
  readonly stashDir?: string;
  readonly summarize: (request: AgentToolObservationSummaryRequest) => Promise<string>;
  readonly persistLlmSummary?: (input: { artifactUri: string; artifactPath: string; summary: string }) => Promise<void>;
}

export interface AgentToolResultObservationInput {
  /** Stable Pi call identity used to correlate derived observation work. */
  readonly requestId?: string;
  readonly toolName: string;
  readonly status: string;
  readonly executionStatus: string;
  readonly outputAvailability: string;
  readonly arguments: unknown;
  readonly process: unknown;
  readonly outcome: unknown;
  readonly result: unknown;
  readonly error?: unknown;
  readonly artifact?: ExecutedToolCallArtifact;
  readonly sourceArtifacts?: readonly AgentToolSourceArtifactReference[];
  readonly artifactAvailability?: unknown;
  readonly systemPrompt: string;
  readonly currentUserMessage: string;
  readonly query?: string;
  readonly notice?: string;
  /** Single effective budget produced by the shared Pi turn-token budget. */
  readonly observationBudgetTokens: number;
  readonly signal?: AbortSignal;
}

const compressionInstruction =
  "Summarize the supplied tool result for the current user request. Preserve task-relevant findings, exact identifiers, paths, URLs, commands, error messages, numbers, negation, and uncertainty. Do not invent facts. The source may be incomplete; honor its source_complete field. Return only a concise summary.";

export class AgentToolResultObservationCompressor {
  private readonly tokenProjector: AgentTokenProjector;
  private readonly contentPipeline: AgentToolObservationContentPipeline;

  constructor(private readonly options: AgentToolResultObservationCompressorOptions) {
    this.tokenProjector = new AgentTokenProjector(options.model);
    this.contentPipeline = new AgentToolObservationContentPipeline({
      model: options.model,
      stashDir: options.stashDir ?? path.join(tmpdir(), "senera-tool-observation-sift"),
    });
  }

  async compress(input: AgentToolResultObservationInput): Promise<AgentPiToolObservation> {
    const observationBudgetTokens = Number.isFinite(input.observationBudgetTokens)
      ? Math.max(0, Math.floor(input.observationBudgetTokens))
      : 0;
    const tokenBudget = observationBudgetTokens;
    // Arguments are already carried by the assistant tool call, while the
    // execution outcome is projected into the top-level status fields below.
    // Keep only payload-bearing feedback in the observation detail so a new
    // observation does not serialize the same data twice.
    const rawFeedback = compact({
      process: projectProcessFeedback(input.process),
      result: input.result,
    });
    const evidence = projectEvidence(input.artifact?.evidence ?? []);
    const artifactRefs = input.artifact?.structuredSummary?.retrieval.refs ?? [];
    const evidenceUris = evidence.flatMap((entry) =>
      typeof entry.evidence_uri === "string" ? [entry.evidence_uri] : [],
    );
    const common = {
      type: AgentPiToolObservationProtocol.type,
      status: input.status,
      execution_status: input.executionStatus,
      output_availability: input.outputAvailability,
      ...(input.artifact ? { artifact_uri: input.artifact.artifactUri } : {}),
      ...(artifactRefs.length ? { artifact_refs: [...artifactRefs] } : {}),
      ...(evidenceUris.length ? { evidence_uris: evidenceUris } : {}),
      ...(input.error === undefined ? {} : { error: input.error }),
      ...(input.sourceArtifacts?.length
        ? {
            source_artifacts: input.sourceArtifacts.map((source) => ({
              artifact_uri: source.artifactUri,
              refs: [...source.refs],
            })),
          }
        : {}),
    };
    const compile = (
      method: AgentToolObservationCompressionMethod,
      value: unknown,
      incomplete: boolean,
      omissions: readonly { readonly path: string; readonly reason: string; readonly omitted?: number }[] = [],
    ): AgentPiToolObservation =>
      parseAgentPiToolObservation({
        ...common,
        compression_method: method,
        ...(incomplete || input.artifactAvailability !== undefined
          ? {
              observation_view: {
                type: AgentPiToolObservationSourceViewProtocol.type,
                complete: !incomplete,
                omission_count: incomplete ? Math.max(1, omissions.length) : 0,
                omissions: incomplete
                  ? omissions.length > 0
                    ? [...omissions]
                    : [{ path: "/detail/result", reason: "compression" }]
                  : [],
                ...(input.artifactAvailability === undefined
                  ? {}
                  : { artifact_availability: input.artifactAvailability }),
              },
            }
          : {}),
        detail: {
          ...(method === "llm" ? { summary: value } : readObservationDetail(value)),
          ...(evidence.length ? { evidence } : {}),
          ...(input.notice ? { notice: input.notice } : {}),
        },
      });

    const pressureObservation = (reason: string): AgentPiToolObservation =>
      parseAgentPiToolObservation({
        ...common,
        compression_method: "mechanical",
        observation_view: {
          type: AgentPiToolObservationSourceViewProtocol.type,
          complete: false,
          omission_count: 1,
          omissions: [{ path: "/detail", reason }],
          ...(input.artifactAvailability === undefined ? {} : { artifact_availability: input.artifactAvailability }),
        },
        detail: {
          ...(evidence.length ? { evidence } : {}),
          notice: input.artifact
            ? "Context pressure: the complete tool result remains available from its artifact; Pi will compact the conversation before the next model request."
            : "Context pressure: the tool result was bounded for this turn; Pi will compact the conversation before the next model request.",
        },
      });

    // A zero allocation is a valid pressure state. Returning a protocol
    // envelope lets Pi finish the tool turn and invoke its native compaction
    // path instead of converting a successful tool execution into an error.
    if (tokenBudget <= 0) return pressureObservation("context_pressure");

    const verbatim = compile("verbatim", rawFeedback, false);
    if (this.tokenProjector.countJson(verbatim) <= tokenBudget) return verbatim;

    // The Artifact recorder already built the canonical deterministic summary.
    // Reuse it for an Artifact-backed result instead of summarizing the same
    // source a second time for the current observation.
    const artifactFeedback = input.artifact?.structuredSummary
      ? compact({
          process: projectProcessFeedback(input.process),
          ...projectAgentToolResultSummaryForObservation(input.artifact.structuredSummary),
        })
      : undefined;
    const projectionSource = artifactFeedback ?? rawFeedback;
    const mechanicalEnvelope = compile("mechanical", {}, true);
    const mechanicalEnvelopeBudget = this.tokenProjector.countJson({ ...mechanicalEnvelope, detail: {} });
    const contentBudget = Math.max(1, tokenBudget - mechanicalEnvelopeBudget);
    const adaptive = artifactFeedback
      ? {
          value: artifactFeedback,
          omissionCount: 0,
          contentOmissionCount: 0,
          strategy: "lexical" as const,
        }
      : await this.contentPipeline.projectValue(rawFeedback, {
          tokenLimit: contentBudget,
          query: [input.query, input.currentUserMessage, input.toolName].filter(Boolean).join("\n"),
          signal: input.signal,
        });
    const mechanicalCandidate = compile(
      "mechanical",
      adaptive.value,
      true,
      adaptive.omissionCount > 0
        ? [{ path: "/detail/result", reason: "mechanical_compression", omitted: adaptive.omissionCount }]
        : [],
    );
    const mechanicalShell = { ...mechanicalCandidate, detail: {} };
    const mechanicalEnvelopeTokens = this.tokenProjector.countJson(mechanicalShell);
    if (mechanicalEnvelopeTokens > tokenBudget) {
      return pressureObservation("context_pressure_envelope");
    }
    const mechanicalDetailBudget = tokenBudget - mechanicalEnvelopeTokens;
    const mechanicalDetail = this.tokenProjector.projectJson(
      prioritizeObservationDetail(mechanicalCandidate.detail),
      mechanicalDetailBudget,
    );
    const mechanical = parseAgentPiToolObservation({ ...mechanicalShell, detail: mechanicalDetail.projectedValue });
    const mechanicalNeedsLanguageSummary =
      adaptive.contentOmissionCount > 0 || !hasSubstantiveDetail(mechanical.detail);
    if (!mechanicalNeedsLanguageSummary && this.tokenProjector.countJson(mechanical) <= tokenBudget) return mechanical;

    const emptyLlmShell = compile("llm", "", true);
    const fixedEnvelope = { ...emptyLlmShell, detail: {} };
    const fixedEnvelopeTokens = this.tokenProjector.countJson(fixedEnvelope);
    if (fixedEnvelopeTokens > tokenBudget) {
      return pressureObservation("context_pressure_summary_envelope");
    }
    const summaryBudget = tokenBudget - fixedEnvelopeTokens;
    if (summaryBudget <= 0) return pressureObservation("context_pressure_summary");
    const summary = await this.options.summarize({
      requestId: input.requestId,
      systemPrompt: `${compressionInstruction}\n\nAgent system context:\n${input.systemPrompt}`,
      currentUserMessage: input.currentUserMessage,
      toolName: input.toolName,
      arguments: input.arguments,
      feedback: projectionSource,
      ...(input.artifact?.artifactUri ? { artifactUri: input.artifact.artifactUri } : {}),
      evidenceUris,
      tokenBudget: summaryBudget,
      signal: input.signal,
    });
    if (!summary.trim()) throw new Error("Tool-observation compression returned an empty summary.");
    const llmCandidate = compile("llm", summary.trim(), true);
    const llm = parseAgentPiToolObservation(
      this.tokenProjector.projectJsonMember(fixedEnvelope, "detail", llmCandidate.detail, tokenBudget).value,
    );
    if (this.tokenProjector.countJson(llm) > tokenBudget) return pressureObservation("context_pressure_summary");
    if (input.artifact) {
      await this.options.persistLlmSummary?.({
        artifactUri: input.artifact.artifactUri,
        artifactPath: input.artifact.artifactPath,
        summary: summary.trim(),
      });
    }
    return llm;
  }
}

function projectEvidence(records: readonly ToolArtifactEvidenceRecord[]): readonly Record<string, unknown>[] {
  return records.map((record) =>
    compact({
      evidence_uri: record.evidenceUri,
      kind: record.kind,
      locator: record.locator,
      display: record.display,
      label: record.label,
      source: record.source,
      confidence: record.confidence,
      artifact_uri: record.plannerMemory.artifactUri,
      artifact_refs: record.plannerMemory.artifactRefs,
      facts: record.modelSlots,
    }),
  );
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function projectProcessFeedback(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.some(([, entry]) => entry !== undefined && entry !== null && entry !== "") ? value : undefined;
}

function readObservationDetail(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { result: value };
}

function hasSubstantiveDetail(detail: AgentPiToolObservation["detail"]): boolean {
  return ["summary", "error_detail", "process", "result"].some((key) => Object.hasOwn(detail, key));
}

function prioritizeObservationDetail(detail: AgentPiToolObservation["detail"]): AgentPiToolObservation["detail"] {
  const priority = [
    "headline",
    "summary",
    "error_detail",
    "result",
    "evidence",
    "retrieval",
    "continuation",
    "delta",
    "process",
    "summary_facts",
    "limitations",
    "semantic_digest",
    "perception",
    "notice",
  ] as const;
  const entries = new Map(Object.entries(detail));
  return Object.fromEntries(
    priority
      .filter((key) => entries.has(key))
      .map((key) => [key, entries.get(key)])
      .concat([...entries].filter(([key]) => !priority.includes(key as (typeof priority)[number]))),
  ) as AgentPiToolObservation["detail"];
}
