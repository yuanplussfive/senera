import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import { AgentArtifactResultView } from "../Artifacts/AgentArtifactResultView.js";
import { parseAgentPiToolObservation, type AgentPiToolObservation } from "../Pi/AgentPiToolObservation.js";
import { AgentToolSelectedContentCompressor } from "./AgentToolSelectedContentCompressor.js";
import { ArtifactReadResultProtocol, type ArtifactReadPart } from "../Memory/AgentArtifactMemoryTypes.js";
import { AgentPiToolObservationSourceViewProtocol } from "../PiShared/AgentPiToolObservationProtocol.js";
import { projectAgentToolModelOutput } from "../ToolContracts/AgentToolModelOutput.js";
import { AgentToolPerceptionComposer } from "./AgentToolPerceptionComposer.js";
import {
  buildAgentToolObservationMetadata,
  createAgentToolPressureObservation,
  readAgentToolObservationEvidence,
  splitAgentToolFailureFeedback,
  type AgentToolObservationEnvelopeInput,
  type AgentToolObservationOmission,
  type AgentToolPressureObservationOptions,
} from "./AgentToolObservationEnvelope.js";
import type { AgentToolPerceptionDeclaration } from "../Types/AgentToolPerceptionTypes.js";
import type { AgentJsonSchema } from "../ToolContracts/AgentJsonSchemaPointer.js";
import type { ToolArtifactEvidenceRecord } from "../Types/ToolRuntimeTypes.js";

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
}

export interface AgentToolResultObservationInput extends AgentToolObservationEnvelopeInput {
  /** Stable Pi call identity used to correlate derived observation work. */
  readonly requestId?: string;
  readonly toolName: string;
  readonly arguments: unknown;
  readonly process: unknown;
  readonly outcome: unknown;
  readonly resultSchema?: AgentJsonSchema;
  readonly perception?: AgentToolPerceptionDeclaration;
  readonly systemPrompt: string;
  readonly currentUserMessage: string;
  readonly query?: string;
  readonly notice?: string;
  readonly signal?: AbortSignal;
}

const compressionInstruction =
  "Summarize the supplied tool result for the current user request. Preserve task-relevant findings, exact identifiers, paths, URLs, commands, error messages, numbers, negation, and uncertainty. Do not invent facts. The source may be incomplete; honor its source_complete field. Return only a concise summary.";

const FeedbackSources = {
  process: { part: "process", path: "" },
  result: { part: "result", path: "" },
  error_detail: { part: "outcome", path: "/assessment/error" },
} as const satisfies Record<string, { readonly part: ArtifactReadPart; readonly path: string }>;

export class AgentToolResultObservationCompressor {
  private readonly tokenProjector: AgentTokenProjector;
  private readonly selectedContent: AgentToolSelectedContentCompressor;
  private readonly structure: AgentArtifactResultView;
  private readonly perceptionComposer = new AgentToolPerceptionComposer();

  constructor(options: AgentToolResultObservationCompressorOptions) {
    this.tokenProjector = new AgentTokenProjector(options.model);
    this.selectedContent = new AgentToolSelectedContentCompressor(options);
    this.structure = new AgentArtifactResultView(options.model);
  }

  pressure(
    input: AgentToolObservationEnvelopeInput,
    reason: string,
    options: AgentToolPressureObservationOptions = {},
  ): AgentPiToolObservation {
    return createAgentToolPressureObservation(input, this.tokenProjector, reason, options);
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
    const result = projectAgentToolModelOutput(input.result, input.resultSchema);
    const failure = splitAgentToolFailureFeedback(input.error);
    let error = failure.error;
    const notice = [
      input.notice,
      input.perception ? this.perceptionComposer.compose({ declaration: input.perception, result }).phrase : undefined,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" ");
    const rawFeedback = compact({
      process: projectProcessFeedback(input.process),
      result,
      error_detail: failure.detail,
    });
    // Only evidence explicitly derived from the delivered result is redundant.
    // Adapters can supply independent content and media through evidence; older
    // records without provenance also remain visible rather than being guessed.
    const records = readAgentToolObservationEvidence(input);
    let evidence = projectEvidence(records);
    const common = buildAgentToolObservationMetadata(input, records);
    const evidenceUris = common.evidence_uris ?? [];
    const headerOmissions: AgentToolObservationOmission[] = [];
    const evidenceOmissions: AgentToolObservationOmission[] = [];
    const compile = (
      method: AgentToolObservationCompressionMethod,
      value: unknown,
      incomplete: boolean,
      omissions: readonly AgentToolObservationOmission[] = [],
    ): AgentPiToolObservation => {
      const combined = [...headerOmissions, ...evidenceOmissions, ...omissions];
      const viewIncomplete = incomplete || combined.length > 0;
      if (viewIncomplete && combined.length === 0) combined.push({ path: "/detail", reason: "compression" });
      return parseAgentPiToolObservation({
        ...common,
        ...(error ? { error } : {}),
        compression_method: method,
        ...(viewIncomplete || input.artifactAvailability !== undefined
          ? {
              observation_view: {
                type: AgentPiToolObservationSourceViewProtocol.type,
                complete: !viewIncomplete,
                omission_count: combined.length,
                omissions: combined,
                ...(input.artifactAvailability === undefined
                  ? {}
                  : { artifact_availability: input.artifactAvailability }),
              },
            }
          : {}),
        detail: {
          ...(method === "llm" ? { summary: value } : readObservationDetail(value)),
          ...(evidence.length ? { evidence } : {}),
          ...(notice ? { notice } : {}),
        },
      });
    };

    const pressureObservation = (reason: string): AgentPiToolObservation =>
      this.pressure({ ...input, error }, reason, { omissions: headerOmissions });

    // Failure diagnostics are ordinary bounded content. Only the typed failure
    // identity and a message preview belong to the mandatory envelope.
    if (error) {
      const bounded = pressureObservation("context_pressure_envelope");
      if (bounded.error && bounded.error.message !== error.message) {
        rawFeedback.error_detail = { ...failure.detail, message: error.message };
        error = { ...error, message: bounded.error.message };
        headerOmissions.push({ path: "/error/message", reason: "deferred_content" });
      }
    }

    // A zero allocation is a valid pressure state. Returning a protocol
    // envelope lets Pi finish the tool turn and invoke its native compaction
    // path instead of converting a successful tool execution into an error.
    if (tokenBudget <= 0) return pressureObservation("context_pressure");

    const verbatim = compile("verbatim", rawFeedback, false);
    if (this.tokenProjector.countJson(verbatim) <= tokenBudget) return verbatim;

    // Coordinates remain available in the envelope. Verbose evidence is a
    // retrievable source, not mandatory repeated context in every view.
    if (evidence.length > 0) evidenceOmissions.push({ path: "/detail/evidence", reason: "deferred_content" });
    evidence = [];
    const shell = compile("mechanical", {}, true);
    const contentBudget = tokenBudget - this.tokenProjector.countJson(shell);
    if (contentBudget <= 0) return pressureObservation("context_pressure_envelope");

    if (input.artifact) {
      let limit = contentBudget;
      const feedbackParts = Object.entries(FeedbackSources).flatMap(([field, source]) =>
        rawFeedback[field] === undefined ? [] : [{ field, ...source, value: rawFeedback[field] }],
      );
      for (;;) {
        const parts = feedbackParts.map(({ field, part, path, value }) => ({
          field,
          part,
          ...(path ? { path } : {}),
          representation: "structure",
          ...this.structure.structure(value, Math.floor(limit / feedbackParts.length), path),
        }));
        const candidate = compile(
          "mechanical",
          Object.fromEntries(parts.map(({ field, ...part }) => [field, part])),
          parts.some((part) => !part.complete),
          parts
            .filter((part) => !part.complete)
            .map((part) => ({ path: `/detail/${part.field}`, reason: "deferred_content" })),
        );
        const excess = this.tokenProjector.countJson(candidate) - tokenBudget;
        if (excess <= 0) return candidate;
        limit -= excess;
        if (limit <= 0) return pressureObservation("context_pressure_structure");
      }
    }

    const summaryRequest = {
      requestId: input.requestId,
      systemPrompt: compressionInstruction,
      currentUserMessage: input.currentUserMessage,
      toolName: input.toolName,
      arguments: input.arguments,
      evidenceUris,
      tokenBudget: contentBudget,
      signal: input.signal,
    };
    const { result: sourceResult, ...otherFeedback } = rawFeedback;
    const selectionBudget = contentBudget - this.tokenProjector.countJson(otherFeedback);
    const selected =
      selectionBudget > 0
        ? await this.compressSourceSelections(sourceResult, summaryRequest, selectionBudget)
        : undefined;
    if (selected !== undefined) {
      const candidate = compile("mechanical", { ...otherFeedback, result: selected }, true);
      return this.tokenProjector.countJson(candidate) <= tokenBudget
        ? candidate
        : pressureObservation("context_pressure_selection_metadata");
    }
    const projected = await this.selectedContent.compress(rawFeedback, {
      ...summaryRequest,
      tokenBudget: Math.max(
        1,
        contentBudget -
          this.tokenProjector.countJson({
            projection: { method: "mechanical", reason: "mechanical_projection_failed", complete: false },
            result: {},
          }),
      ),
    });
    const candidate = compile(projected.method === "llm" ? "llm" : "mechanical", projected.value, true);
    const fitted = this.tokenProjector.projectJsonMember(
      { ...candidate, detail: {} },
      "detail",
      {
        ...candidate.detail,
        projection: {
          method: projected.method,
          complete: projected.complete,
          ...(projected.reason ? { reason: projected.reason } : {}),
        },
      },
      tokenBudget,
    );
    return parseAgentPiToolObservation(fitted.value);
  }

  private async compressSourceSelections(
    result: unknown,
    request: Omit<AgentToolObservationSummaryRequest, "feedback">,
    budget: number,
  ): Promise<unknown | undefined> {
    if (
      !isRecord(result) ||
      result.type !== ArtifactReadResultProtocol ||
      !isRecord(result.artifacts) ||
      !Array.isArray(result.artifacts.item)
    )
      return undefined;
    const items = result.artifacts.item;
    const selected = items
      .flatMap((item: unknown, itemIndex: number) => {
        if (!isRecord(item) || !isRecord(item.content)) return [];
        const entries: Array<{ node: Record<string, unknown>; key: "value" | "outline"; index: number }> =
          item.content.representation === "structure"
            ? [{ node: item.content, key: "outline", index: 0 }]
            : Array.isArray(item.content.selections)
              ? item.content.selections.flatMap((entry: unknown, index: number) =>
                  isRecord(entry) &&
                  entry.status === "found" &&
                  (entry.representation === "original" || entry.representation === "structure")
                    ? [{ node: entry, key: "value" as const, index }]
                    : [],
                )
              : [];
        return entries.map((entry) => ({
          ...entry,
          itemIndex,
          uri: item.artifactUri,
          tokens: this.tokenProjector.countJson(entry.node[entry.key]),
        }));
      })
      .sort((left, right) => left.tokens - right.tokens);
    if (!selected.length) return result;
    const replacements = new Map<Record<string, unknown>, Record<string, unknown>>(
      selected.map(({ node, key }) => [
        node,
        {
          ...node,
          [key]: "",
          representation: node.representation === "structure" ? "structure" : "excerpt",
          method: "mechanical",
          complete: false,
          reason: "mechanical_projection_failed",
        },
      ]),
    );
    const build = (): unknown => ({
      ...result,
      artifacts: {
        ...(result.artifacts as Record<string, unknown>),
        item: items.map((item: unknown) => {
          if (!isRecord(item) || !isRecord(item.content)) return item;
          const replacement = replacements.get(item.content);
          if (replacement) return { ...item, content: replacement };
          if (!Array.isArray(item.content.selections)) return item;
          return {
            ...item,
            content: {
              ...item.content,
              selections: item.content.selections.map((entry: unknown) =>
                isRecord(entry) ? (replacements.get(entry) ?? entry) : entry,
              ),
            },
          };
        }),
      },
    });
    for (const [position, { node, key, itemIndex, index, uri, tokens }] of selected.entries()) {
      const remaining = budget - this.tokenProjector.countJson({ result: build() });
      const limit = Math.max(0, Math.floor(remaining / (selected.length - position)));
      if (node.representation === "structure") {
        const view = this.structure.fit(
          { outline: node[key], complete: node.complete === true },
          limit,
          typeof node.path === "string" ? node.path : "",
        );
        replacements.set(node, { ...node, [key]: view.outline, complete: view.complete });
        continue;
      }
      const value = node[key];
      const exact = { ...node, method: "verbatim" };
      const exactCost = this.tokenProjector.countJson(exact) - this.tokenProjector.countJson(replacements.get(node));
      if (
        (tokens <= limit || value === null || typeof value === "number" || typeof value === "boolean") &&
        exactCost <= Math.max(0, remaining)
      ) {
        replacements.set(node, exact);
        continue;
      }
      if (limit <= 0) {
        const view = this.structure.structure(value, 0, typeof node.path === "string" ? node.path : "");
        replacements.set(node, { ...node, [key]: view.outline, representation: "structure", complete: view.complete });
        continue;
      }
      const view = await this.selectedContent.compress(value, {
        ...request,
        requestId: `${request.requestId ?? "artifact-read"}:${itemIndex}:${index}`,
        ...(typeof uri === "string" ? { artifactUri: uri } : {}),
        tokenBudget: limit,
      });
      replacements.set(node, { ...node, ...view });
    }
    return build();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function readObservationDetail(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { result: value };
}
