import { compactObject, readArray, readRecord } from "../ActionPlanner/AgentActionPlannerProjectionUtils.js";
import { readAgentString, type AgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import {
  AgentPiToolObservationProtocol,
  AgentPiToolObservationSourceViewProtocol,
  parseAgentPiToolObservation,
  type AgentPiToolObservation,
} from "../Pi/AgentPiToolObservation.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import {
  AgentToolObservationProjectionModes,
  AgentToolObservationProjectionSources,
  type AgentToolObservationContinuationProjection,
  type AgentToolObservationProjectionManifest,
  type AgentToolObservationProjectionSource,
  type AgentToolObservationProjectionSourceRule,
  type AgentToolObservationStructuralLimits,
} from "../Types/AgentToolObservationProjectionTypes.js";
import { AgentPiToolObservationStatuses } from "../PiShared/AgentPiToolObservationStatus.js";
import { AgentToolObservationPriorityOrder } from "./AgentToolObservationProjectionPlan.js";
import {
  AgentToolAdaptiveTextProjector,
  type AgentToolAdaptiveValueProjectionResult,
} from "./AgentToolAdaptiveTextProjection.js";
import {
  AgentToolContentPolicyCompressionModes,
  AgentToolContentPolicyOwnerships,
  type AgentToolContentPolicy,
} from "../Types/AgentToolContentPolicyTypes.js";
import {
  AgentToolObservationOmissionReasons,
  AgentToolObservationStructuralProjector,
  selectAgentToolObservationPointer,
  type AgentToolObservationProjectionOmission,
  type AgentToolObservationStructuralProjection,
} from "./AgentToolObservationStructuralProjector.js";

export interface AgentToolObservationContextCompilerOptions {
  readonly model: string;
}

export interface AgentToolObservationContextCompilerInput {
  readonly toolName: unknown;
  readonly callId: unknown;
  readonly batchId: unknown;
  readonly status: unknown;
  readonly executionStatus: unknown;
  readonly outputAvailability: unknown;
  readonly summary?: unknown;
  readonly outcome: unknown;
  readonly process: unknown;
  readonly error: unknown;
  readonly result: unknown;
  /** Optional host content-policy view; complete result remains in Artifact. */
  readonly projectedResult?: unknown;
  /** Declarative host-owned content contract used for large text projection. */
  readonly contentPolicy?: AgentToolContentPolicy;
  /** Compact current-call purpose; never includes the durable transcript. */
  readonly compressionQuery?: string;
  readonly signal?: AbortSignal;
  readonly arguments: unknown;
  readonly artifact: unknown;
  readonly artifactAvailability?: unknown;
  readonly semanticProjection?: unknown;
  readonly perception?: unknown;
  /** Host note appended to the observation detail, e.g. dropped wrapper keys. */
  readonly notice?: unknown;
  /** Verbatim result already inlined into the model context; folds all
   * summarization, evidence, and retrieval sources down to the result. */
  readonly inline?: unknown;
}

interface ProjectedSource {
  readonly key: string;
  readonly requiredForCompletion: boolean;
  readonly value: unknown;
  readonly complete: boolean;
  readonly omissionCount: number;
  readonly omissions: readonly AgentToolObservationProjectionOmission[];
}

const RuntimeFailureLimits: AgentToolObservationStructuralLimits = {
  maxDepth: 3,
  maxArrayItems: 8,
  maxObjectProperties: 8,
  maxNodes: 48,
};

const RuntimeFailureTokenLimit = 512;

const InlineAllowedSources = new Set<AgentToolObservationProjectionSource>([
  AgentToolObservationProjectionSources.Result,
  AgentToolObservationProjectionSources.Error,
]);

const SourceOutputKeys = {
  [AgentToolObservationProjectionSources.Headline]: "headline",
  [AgentToolObservationProjectionSources.Summary]: "summary",
  [AgentToolObservationProjectionSources.Error]: "error_detail",
  [AgentToolObservationProjectionSources.Process]: "process",
  [AgentToolObservationProjectionSources.Retrieval]: "retrieval",
  [AgentToolObservationProjectionSources.Continuation]: "continuation",
  [AgentToolObservationProjectionSources.Evidence]: "evidence",
  [AgentToolObservationProjectionSources.Delta]: "delta",
  [AgentToolObservationProjectionSources.Workspace]: "workspace",
  [AgentToolObservationProjectionSources.Result]: "result",
  [AgentToolObservationProjectionSources.Arguments]: "arguments",
  [AgentToolObservationProjectionSources.ArtifactProjection]: "projection",
  [AgentToolObservationProjectionSources.SummaryFacts]: "summary_facts",
  [AgentToolObservationProjectionSources.Limitations]: "limitations",
  [AgentToolObservationProjectionSources.Outcome]: "outcome",
  [AgentToolObservationProjectionSources.SemanticDigest]: "semantic_digest",
  [AgentToolObservationProjectionSources.Perception]: "perception",
} as const satisfies Record<AgentToolObservationProjectionSource, string>;

export class AgentToolObservationContextCompiler {
  private readonly tokenProjector: AgentTokenProjector;
  private readonly structuralProjector = new AgentToolObservationStructuralProjector();
  private readonly adaptiveTextProjector: AgentToolAdaptiveTextProjector;

  constructor(options: AgentToolObservationContextCompilerOptions) {
    this.tokenProjector = new AgentTokenProjector(options.model);
    this.adaptiveTextProjector = new AgentToolAdaptiveTextProjector(options.model);
  }

  compile(
    input: AgentToolObservationContextCompilerInput,
    manifest: AgentToolObservationProjectionManifest,
    availableTokens = manifest.maxTokens,
  ): AgentPiToolObservation {
    const maxTokens = Math.max(1, Math.min(manifest.maxTokens, normalizePositiveInteger(availableTokens)));
    const artifact = readRecord(input.artifact);
    const structuredSummary = readRecord(artifact?.structuredSummary);
    const artifactUri = inputArtifactUri(artifact);
    const requiredFailure = this.projectRequiredFailure(
      input.status,
      input.error,
      manifest.maxOmissions,
      Math.min(maxTokens, RuntimeFailureTokenLimit),
    );
    const envelope = compactObject({
      type: AgentPiToolObservationProtocol.type,
      status: input.status,
      execution_status: input.executionStatus,
      output_availability: input.outputAvailability,
      error: requiredFailure?.value,
    });
    const orderedRules = orderRules(manifest.sources).filter(
      (rule) => input.inline === undefined || input.inline === false || InlineAllowedSources.has(rule.source),
    );
    const projectedSources = orderedRules.flatMap((rule) => {
      const source = this.readSource(rule.source, input, artifact, structuredSummary, manifest.continuation);
      if (source === undefined) return [];
      return [this.projectSource(source, rule, manifest.maxOmissions, maxTokens, input)];
    });
    const failureOmissions = prefixOmissions("error", requiredFailure?.omissions ?? []);
    const initialOmissions = [...failureOmissions, ...projectedSources.flatMap((source) => source.omissions)];
    const initialOmissionCount =
      (requiredFailure?.omissionCount ?? 0) +
      projectedSources.reduce((total, source) => total + source.omissionCount, 0);
    const requiredOmissionCount =
      (requiredFailure?.omissionCount ?? 0) +
      projectedSources.reduce((total, source) => total + (source.requiredForCompletion ? source.omissionCount : 0), 0);
    const detail = Object.fromEntries(projectedSources.map((source) => [source.key, source.value]));
    if (typeof input.notice === "string" && input.notice.trim().length > 0) {
      detail.notice = input.notice.trim();
    }
    const initialView = sourceView({
      complete:
        requiredOmissionCount === 0 &&
        projectedSources.every((source) => source.complete || !source.requiredForCompletion),
      omissionCount: initialOmissionCount,
      omissions: initialOmissions.slice(0, manifest.maxOmissions),
      artifactUri,
      artifactAvailability: input.artifactAvailability,
    });
    const initialProjection = this.projectDetail(envelope, initialView, detail, maxTokens);
    if (!initialProjection) {
      return this.minimumObservation(envelope, artifactUri, input.artifactAvailability, initialOmissionCount);
    }
    const tokenOmission: AgentToolObservationProjectionOmission[] = initialProjection.complete
      ? []
      : [{ path: "/detail", reason: AgentToolObservationOmissionReasons.TokenLimit }];
    const allOmissions = [...initialOmissions, ...tokenOmission];
    const view = sourceView({
      complete:
        requiredOmissionCount === 0 &&
        projectedSources.every((source) => source.complete || !source.requiredForCompletion) &&
        initialProjection.complete,
      omissionCount: initialOmissionCount + tokenOmission.length,
      omissions: allOmissions.slice(0, manifest.maxOmissions),
      artifactUri,
      artifactAvailability: input.artifactAvailability,
    });
    const finalProjection = this.projectDetail(envelope, view, detail, maxTokens);
    return finalProjection
      ? parseAgentPiToolObservation(finalProjection.value)
      : this.minimumObservation(envelope, artifactUri, input.artifactAvailability, initialOmissionCount);
  }

  private projectDetail(
    envelope: Readonly<Record<string, unknown>>,
    view: AgentUnknownRecord,
    detail: Readonly<Record<string, unknown>>,
    tokenLimit: number,
  ) {
    const observationEnvelope = shouldEmitObservationView(view) ? { ...envelope, observation_view: view } : envelope;
    return this.tokenProjector.fitsJson({ ...observationEnvelope, detail: {} }, tokenLimit)
      ? this.tokenProjector.projectJsonMember(observationEnvelope, "detail", detail, tokenLimit)
      : undefined;
  }

  private minimumObservation(
    envelope: Readonly<Record<string, unknown>>,
    artifactUri: string | undefined,
    artifactAvailability: unknown,
    sourceOmissionCount: number,
  ): AgentPiToolObservation {
    const minimum = {
      ...envelope,
      observation_view: sourceView({
        complete: false,
        omissionCount: Math.max(1, sourceOmissionCount + 1),
        omissions: [{ path: "/detail", reason: AgentToolObservationOmissionReasons.TokenLimit }],
        artifactUri,
        artifactAvailability,
      }),
      detail: {},
    };
    return parseAgentPiToolObservation(minimum);
  }

  private projectRequiredFailure(
    status: unknown,
    error: unknown,
    maxOmissions: number,
    tokenLimit: number,
  ): AgentToolObservationStructuralProjection | undefined {
    if (status !== AgentPiToolObservationStatuses.Failure) return undefined;
    const record = readRecord(error);
    if (!record) return undefined;
    // The error message is the model's primary correction signal and must not
    // be folded as an ordinary long leaf: a collapsed message forces the model
    // to guess how to recover. It gets an independent projection with a
    // bounded preview, while the envelope fields share the remaining budget.
    const structural = this.structuralProjector.project(
      compactObject({
        code: record.code,
        kind: record.kind,
        source: record.source,
        retryable: record.retryable,
        diagnostics: this.projectFailureDiagnostics(record.diagnostics),
      }),
      RuntimeFailureLimits,
      maxOmissions,
    );
    const envelopeTokenLimit = structural.complete
      ? tokenLimit
      : Math.max(1, tokenLimit - structural.omissionCount * 16);
    const envelopeProjection = this.tokenProjector.projectJson(structural.value, envelopeTokenLimit);
    const message = typeof record.message === "string" ? record.message : "";
    const messageTokenLimit = Math.min(
      tokenLimit,
      Math.max(1, tokenLimit - Math.max(0, envelopeProjection.tokenCount)),
    );
    const messageProjection = this.tokenProjector.previewText(message, messageTokenLimit);
    const messageOmitted = messageProjection.truncated ? 1 : 0;
    const envelopeProjected =
      envelopeProjection.projectedValue !== null &&
      typeof envelopeProjection.projectedValue === "object" &&
      !Array.isArray(envelopeProjection.projectedValue)
        ? (envelopeProjection.projectedValue as Record<string, unknown>)
        : {};
    const omissions = [
      ...structural.omissions,
      ...(envelopeProjection.complete
        ? []
        : [{ path: "", reason: AgentToolObservationOmissionReasons.TokenLimit } as const]),
      ...(messageOmitted
        ? [{ path: "/message", reason: AgentToolObservationOmissionReasons.TokenLimit } as const]
        : []),
    ].slice(0, maxOmissions);
    return {
      value: {
        ...envelopeProjected,
        message: messageProjection.text,
      },
      complete: structural.complete && envelopeProjection.complete && !messageProjection.truncated,
      omissionCount: structural.omissionCount + (envelopeProjection.complete ? 0 : 1) + messageOmitted,
      omissions,
    };
  }

  private projectFailureDiagnostics(value: unknown): readonly Record<string, string>[] | undefined {
    const entries = readArray(value)
      .flatMap((entry) => {
        const record = readRecord(entry);
        if (!record) return [];
        const message = typeof record.message === "string" ? record.message.trim() : "";
        if (!message) return [];
        const path = Array.isArray(record.path)
          ? record.path.map((part) => String(part)).join(".")
          : typeof record.path === "string"
            ? record.path
            : undefined;
        const pointer = typeof record.pointer === "string" ? record.pointer : undefined;
        const code = typeof record.code === "string" ? record.code : undefined;
        const suggestion = typeof record.suggestion === "string" ? record.suggestion : undefined;
        return [
          {
            ...(code ? { code } : {}),
            ...(path ? { path } : {}),
            ...(pointer ? { pointer } : {}),
            message,
            ...(suggestion ? { suggestion } : {}),
          },
        ];
      })
      .slice(0, 8);
    return entries.length > 0 ? entries : undefined;
  }

  private projectSource(
    source: unknown,
    rule: AgentToolObservationProjectionSourceRule,
    maxOmissions: number,
    availableTokens: number,
    input: AgentToolObservationContextCompilerInput,
  ): ProjectedSource {
    const key = SourceOutputKeys[rule.source];
    if (rule.mode === AgentToolObservationProjectionModes.ArtifactOnly) {
      return {
        key,
        requiredForCompletion: rule.requiredForCompletion,
        value: undefined,
        complete: false,
        omissionCount: 1,
        omissions: [{ path: `/${key}`, reason: AgentToolObservationOmissionReasons.ArtifactPolicy }],
      };
    }
    const selected = selectAgentToolObservationPointer(source, rule.pointer);
    if (!matchesProjectionMode(selected, rule.mode)) {
      return {
        key,
        requiredForCompletion: rule.requiredForCompletion,
        value: undefined,
        complete: false,
        omissionCount: 1,
        omissions: [{ path: `/${key}`, reason: AgentToolObservationOmissionReasons.TypeMismatch }],
      };
    }
    const sourceTokenLimit = resolveSourceTokenLimit(rule, availableTokens);
    const adaptive = this.projectAdaptiveSource(selected, rule, sourceTokenLimit, input);
    const structural = this.structuralProjector.project(adaptive.value, rule.limits, maxOmissions);
    const adaptiveOmissions = adaptive.changed
      ? [{ path: "", reason: AgentToolObservationOmissionReasons.ContentProjection } as const]
      : [];
    if (rule.mode === AgentToolObservationProjectionModes.Text && typeof structural.value === "string") {
      const preview = this.tokenProjector.previewText(structural.value, sourceTokenLimit);
      const tokenOmitted = preview.truncated ? 1 : 0;
      return {
        key,
        requiredForCompletion: rule.requiredForCompletion,
        value: preview.text,
        complete: adaptive.complete && structural.complete && !preview.truncated,
        omissionCount: adaptive.omissionCount + structural.omissionCount + tokenOmitted,
        omissions: [
          ...prefixOmissions(key, adaptiveOmissions),
          ...prefixOmissions(key, structural.omissions),
          ...(preview.truncated
            ? [{ path: `/${key}`, reason: AgentToolObservationOmissionReasons.TokenLimit } as const]
            : []),
        ],
      };
    }
    const tokenProjection = this.tokenProjector.projectJson(structural.value, sourceTokenLimit);
    const tokenOmitted = tokenProjection.complete ? 0 : 1;
    return {
      key,
      requiredForCompletion: rule.requiredForCompletion,
      value: tokenProjection.projectedValue,
      complete: adaptive.complete && structural.complete && tokenProjection.complete,
      omissionCount: adaptive.omissionCount + structural.omissionCount + tokenOmitted,
      omissions: [
        ...prefixOmissions(key, adaptiveOmissions),
        ...prefixOmissions(key, structural.omissions),
        ...(tokenProjection.complete
          ? []
          : [{ path: `/${key}`, reason: AgentToolObservationOmissionReasons.TokenLimit } as const]),
      ],
    };
  }

  private projectAdaptiveSource(
    selected: unknown,
    rule: AgentToolObservationProjectionSourceRule,
    tokenLimit: number,
    input: AgentToolObservationContextCompilerInput,
  ): AgentToolAdaptiveValueProjectionResult {
    const policy = input.contentPolicy;
    const enabled =
      rule.source === AgentToolObservationProjectionSources.Result &&
      policy?.ownership === AgentToolContentPolicyOwnerships.Host &&
      policy.compression === AgentToolContentPolicyCompressionModes.Bounded;
    if (!enabled) {
      return { value: selected, complete: true, changed: false, omissionCount: 0, strategy: "unchanged" };
    }
    return this.adaptiveTextProjector.projectTargets(selected, policy.targets, {
      tokenLimit,
      query: input.compressionQuery,
      preserve: policy.preserve,
      signal: input.signal,
    });
  }

  private readSource(
    source: AgentToolObservationProjectionSource,
    input: AgentToolObservationContextCompilerInput,
    artifact: Record<string, unknown> | undefined,
    structuredSummary: Record<string, unknown> | undefined,
    continuation: AgentToolObservationContinuationProjection | undefined,
  ): unknown {
    switch (source) {
      case AgentToolObservationProjectionSources.Headline:
        return structuredSummary?.headline;
      case AgentToolObservationProjectionSources.Summary:
        return input.summary ?? structuredSummary?.summary ?? artifact?.summary;
      case AgentToolObservationProjectionSources.Error:
        return input.error;
      case AgentToolObservationProjectionSources.Process:
        return input.process;
      case AgentToolObservationProjectionSources.Retrieval:
        return structuredSummary?.retrieval;
      case AgentToolObservationProjectionSources.Continuation:
        return projectContinuation(input.result, continuation);
      case AgentToolObservationProjectionSources.Evidence:
        return readArray(artifact?.evidence).map(projectEvidenceSource);
      case AgentToolObservationProjectionSources.Delta:
        return readArray(artifact?.delta).map(projectDeltaSource);
      case AgentToolObservationProjectionSources.Workspace:
        return artifact?.workspace;
      case AgentToolObservationProjectionSources.Result:
        return input.projectedResult ?? input.result;
      case AgentToolObservationProjectionSources.Arguments:
        return input.arguments;
      case AgentToolObservationProjectionSources.ArtifactProjection:
        return artifact?.projection;
      case AgentToolObservationProjectionSources.SummaryFacts:
        return structuredSummary?.facts;
      case AgentToolObservationProjectionSources.Limitations:
        return structuredSummary?.limitations;
      case AgentToolObservationProjectionSources.Outcome:
        return input.outcome;
      case AgentToolObservationProjectionSources.SemanticDigest:
        return readAgentString(readRecord(input.semanticProjection)?.text);
      case AgentToolObservationProjectionSources.Perception:
        return readAgentString(input.perception);
    }
  }
}

function sourceView(input: {
  complete: boolean;
  omissionCount: number;
  omissions: readonly AgentToolObservationProjectionOmission[];
  artifactUri: string | undefined;
  artifactAvailability: unknown;
}): AgentUnknownRecord {
  return {
    type: AgentPiToolObservationSourceViewProtocol.type,
    complete: input.complete,
    omission_count: input.omissionCount,
    omissions: input.omissions,
    artifact_uri: input.artifactUri,
    ...(input.artifactAvailability === undefined ? {} : { artifact_availability: input.artifactAvailability }),
  };
}

/**
 * v5 omits the completeness declaration for fully projected observations: a
 * complete view with zero omissions carries no information for the model and
 * only burns tokens. It is emitted only when something was trimmed, omitted,
 * or the artifact itself is unavailable.
 */
function shouldEmitObservationView(view: AgentUnknownRecord): boolean {
  const complete = view.complete === true;
  const omissionCount = readOmissionCount(view.omission_count);
  return !complete || omissionCount > 0 || view.artifact_availability !== undefined;
}

function readOmissionCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function projectContinuation(
  result: unknown,
  policy: AgentToolObservationContinuationProjection | undefined,
): AgentUnknownRecord | undefined {
  if (!policy) return undefined;
  const handle = readContinuationScalar(result, policy.handle);
  if (handle === undefined) return undefined;
  const state = policy.state ? readContinuationScalar(result, policy.state) : undefined;
  return compactObject({
    kind: policy.kind,
    handle,
    cursor: policy.cursor ? readContinuationScalar(result, policy.cursor) : undefined,
    state,
    terminal:
      state === undefined || !policy.terminalStates
        ? undefined
        : policy.terminalStates.some((terminalState) => terminalState === String(state)),
  });
}

function readContinuationScalar(root: unknown, pointer: string): string | number | boolean | undefined {
  const value = selectAgentToolObservationPointer(root, pointer);
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}

function projectEvidenceSource(value: unknown): unknown {
  const record = readRecord(value);
  if (!record) return value;
  const plannerMemory = readRecord(record.plannerMemory);
  return compactObject({
    evidence_uri: record.evidenceUri,
    kind: record.kind,
    locator: record.locator,
    display: record.display,
    label: record.label,
    source: record.source,
    confidence: record.confidence,
    artifact_uri: plannerMemory?.artifactUri,
    artifact_refs: plannerMemory?.artifactRefs,
    facts: readArray(record.modelSlots ?? record.slots).map((fact) => {
      const factRecord = readRecord(fact);
      return factRecord ? compactObject({ name: factRecord.name, value: factRecord.value }) : fact;
    }),
  });
}

function projectDeltaSource(value: unknown): unknown {
  const record = readRecord(value);
  return record ? compactObject({ kind: record.kind, status: record.status, summary: record.summary }) : value;
}

function matchesProjectionMode(value: unknown, mode: AgentToolObservationProjectionSourceRule["mode"]): boolean {
  if (mode === AgentToolObservationProjectionModes.Text) return typeof value === "string";
  if (mode === AgentToolObservationProjectionModes.OrderedArray) return Array.isArray(value);
  return value !== undefined;
}

function orderRules(
  rules: readonly AgentToolObservationProjectionSourceRule[],
): AgentToolObservationProjectionSourceRule[] {
  const priority = new Map(AgentToolObservationPriorityOrder.map((tier, index) => [tier, index]));
  return rules
    .map((rule, index) => ({ rule, index }))
    .sort(
      (left, right) =>
        (priority.get(left.rule.priority) ?? AgentToolObservationPriorityOrder.length) -
          (priority.get(right.rule.priority) ?? AgentToolObservationPriorityOrder.length) || left.index - right.index,
    )
    .map(({ rule }) => rule);
}

function prefixOmissions(
  key: string,
  omissions: readonly AgentToolObservationProjectionOmission[],
): AgentToolObservationProjectionOmission[] {
  return omissions.map((omission) => ({
    ...omission,
    path: `/${escapeJsonPointerSegment(key)}${omission.path}`,
  }));
}

function inputArtifactUri(artifact: Record<string, unknown> | undefined): string | undefined {
  return readAgentString(artifact?.artifactUri);
}

function escapeJsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function normalizePositiveInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function resolveSourceTokenLimit(rule: AgentToolObservationProjectionSourceRule, availableTokens: number): number {
  const declaredLimit = normalizePositiveInteger(rule.maxTokens);
  if (rule.budgetShare === undefined) return declaredLimit;
  // A small reservation is already bounded by the enclosing observation
  // budget. Applying the share again would hide high-signal coordinates such
  // as cursors before the envelope has a chance to project them.
  if (declaredLimit > availableTokens) return declaredLimit;
  return Math.min(declaredLimit, Math.max(1, Math.floor(availableTokens * rule.budgetShare)));
}
