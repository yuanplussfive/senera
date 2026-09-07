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
  readonly arguments: unknown;
  readonly artifact: unknown;
  readonly artifactAvailability?: unknown;
  readonly semanticProjection?: unknown;
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
  maxArrayItems: 0,
  maxObjectProperties: 8,
  maxNodes: 24,
};

const RuntimeFailureTokenLimit = 512;

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
} as const satisfies Record<AgentToolObservationProjectionSource, string>;

export class AgentToolObservationContextCompiler {
  private readonly tokenProjector: AgentTokenProjector;
  private readonly structuralProjector = new AgentToolObservationStructuralProjector();

  constructor(options: AgentToolObservationContextCompilerOptions) {
    this.tokenProjector = new AgentTokenProjector(options.model);
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
    const orderedRules = orderRules(manifest.sources);
    const projectedSources = orderedRules.flatMap((rule) => {
      const source = this.readSource(rule.source, input, artifact, structuredSummary, manifest.continuation);
      if (source === undefined) return [];
      return [this.projectSource(source, rule, manifest.maxOmissions)];
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
    const observationEnvelope = { ...envelope, observation_view: view };
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
    const structural = this.structuralProjector.project(
      compactObject({
        code: record.code,
        kind: record.kind,
        source: record.source,
        retryable: record.retryable,
        message: record.message,
      }),
      RuntimeFailureLimits,
      maxOmissions,
    );
    const tokenProjection = this.tokenProjector.projectJson(structural.value, tokenLimit);
    return {
      value: tokenProjection.projectedValue,
      complete: structural.complete && tokenProjection.complete,
      omissionCount: structural.omissionCount + (tokenProjection.complete ? 0 : 1),
      omissions: [
        ...structural.omissions,
        ...(tokenProjection.complete
          ? []
          : [{ path: "", reason: AgentToolObservationOmissionReasons.TokenLimit } as const]),
      ].slice(0, maxOmissions),
    };
  }

  private projectSource(
    source: unknown,
    rule: AgentToolObservationProjectionSourceRule,
    maxOmissions: number,
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
    const structural = this.structuralProjector.project(selected, rule.limits, maxOmissions);
    if (rule.mode === AgentToolObservationProjectionModes.Text && typeof structural.value === "string") {
      const preview = this.tokenProjector.previewText(structural.value, rule.maxTokens);
      const tokenOmitted = preview.truncated ? 1 : 0;
      return {
        key,
        requiredForCompletion: rule.requiredForCompletion,
        value: preview.text,
        complete: structural.complete && !preview.truncated,
        omissionCount: structural.omissionCount + tokenOmitted,
        omissions: [
          ...prefixOmissions(key, structural.omissions),
          ...(preview.truncated
            ? [{ path: `/${key}`, reason: AgentToolObservationOmissionReasons.TokenLimit } as const]
            : []),
        ],
      };
    }
    const tokenProjection = this.tokenProjector.projectJson(structural.value, rule.maxTokens);
    const tokenOmitted = tokenProjection.complete ? 0 : 1;
    return {
      key,
      requiredForCompletion: rule.requiredForCompletion,
      value: tokenProjection.projectedValue,
      complete: structural.complete && tokenProjection.complete,
      omissionCount: structural.omissionCount + tokenOmitted,
      omissions: [
        ...prefixOmissions(key, structural.omissions),
        ...(tokenProjection.complete
          ? []
          : [{ path: `/${key}`, reason: AgentToolObservationOmissionReasons.TokenLimit } as const]),
      ],
    };
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
        return input.result;
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
