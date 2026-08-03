import { compactObject, readArray, readRecord } from "../ActionPlanner/AgentActionPlannerProjectionUtils.js";
import { readAgentString, type AgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import {
  AgentPiToolObservationSourceViewProtocol,
  createAgentPiToolObservation,
} from "../Pi/AgentPiToolObservation.js";
import { AgentBudgetedJsonProjector } from "../Text/AgentBudgetedJsonProjection.js";
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
}

interface ProjectedSource {
  readonly key: string;
  readonly value: unknown;
  readonly complete: boolean;
  readonly omissionCount: number;
  readonly omissions: readonly AgentToolObservationProjectionOmission[];
}

const RuntimeFailureLimits: AgentToolObservationStructuralLimits = {
  maxDepth: 3,
  maxArrayItems: 0,
  maxObjectProperties: 8,
  maxStringCharacters: 1_024,
  maxTotalCharacters: 2_048,
  maxNodes: 24,
};

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
} as const satisfies Record<AgentToolObservationProjectionSource, string>;

export class AgentToolObservationContextCompiler {
  private readonly tokenProjector: AgentTokenProjector;
  private readonly jsonProjector: AgentBudgetedJsonProjector;
  private readonly structuralProjector = new AgentToolObservationStructuralProjector();

  constructor(options: AgentToolObservationContextCompilerOptions) {
    this.tokenProjector = new AgentTokenProjector(options.model);
    this.jsonProjector = new AgentBudgetedJsonProjector(options.model);
  }

  compile(
    input: AgentToolObservationContextCompilerInput,
    manifest: AgentToolObservationProjectionManifest,
    availableTokens = manifest.maxTokens,
  ): AgentUnknownRecord {
    const maxTokens = Math.max(1, Math.min(manifest.maxTokens, normalizePositiveInteger(availableTokens)));
    const artifact = readRecord(input.artifact);
    const structuredSummary = readRecord(artifact?.structuredSummary);
    const artifactUri = inputArtifactUri(artifact);
    const requiredFailure = this.projectRequiredFailure(input.status, input.error, manifest.maxOmissions);
    const envelope = createAgentPiToolObservation(
      compactObject({
        tool_name: input.toolName,
        call_id: input.callId,
        batch_id: input.batchId,
        status: input.status,
        execution_status: input.executionStatus,
        output_availability: input.outputAvailability,
        artifact_uri: artifactUri,
        error: requiredFailure?.value,
      }),
    );
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
    const detail = Object.fromEntries(projectedSources.map((source) => [source.key, source.value]));
    const initialView = sourceView({
      complete: projectedSources.every((source) => source.complete),
      omissionCount: initialOmissionCount,
      omissions: initialOmissions.slice(0, manifest.maxOmissions),
      artifactUri,
      manifest,
    });
    const detailBudget = Math.max(
      1,
      maxTokens - this.tokenProjector.countJson({ ...envelope, observation_view: initialView, detail: {} }),
    );
    const detailProjection = this.jsonProjector.project(detail, detailBudget);
    const tokenOmission: AgentToolObservationProjectionOmission[] = detailProjection.complete
      ? []
      : [{ path: "/detail", reason: AgentToolObservationOmissionReasons.TokenLimit }];
    const allOmissions = [...initialOmissions, ...tokenOmission];
    const view = sourceView({
      complete: initialOmissionCount === 0 && detailProjection.complete,
      omissionCount: initialOmissionCount + tokenOmission.length,
      omissions: allOmissions.slice(0, manifest.maxOmissions),
      artifactUri,
      manifest,
    });
    return this.fitObservation(envelope, view, detail, detailProjection.value, maxTokens, manifest.maxOmissions);
  }

  private fitObservation(
    envelope: AgentUnknownRecord,
    view: AgentUnknownRecord,
    detail: AgentUnknownRecord,
    projectedDetail: unknown,
    maxTokens: number,
    maxOmissions: number,
  ): AgentUnknownRecord {
    const candidate = { ...envelope, observation_view: view, detail: projectedDetail };
    if (this.tokenProjector.fitsJson(candidate, maxTokens)) return candidate;

    const boundedView = appendTokenOmission(view, maxOmissions);
    const fixedTokens = this.tokenProjector.countJson({ ...envelope, observation_view: boundedView, detail: {} });
    let low = 1;
    let high = Math.max(1, maxTokens - fixedTokens);
    let best: unknown = {};
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const projection = this.jsonProjector.project(detail, middle);
      const current = { ...envelope, observation_view: boundedView, detail: projection.value };
      if (this.tokenProjector.fitsJson(current, maxTokens)) {
        best = projection.value;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return { ...envelope, observation_view: boundedView, detail: best };
  }

  private projectRequiredFailure(
    status: unknown,
    error: unknown,
    maxOmissions: number,
  ): AgentToolObservationStructuralProjection | undefined {
    if (status !== AgentPiToolObservationStatuses.Failure) return undefined;
    const record = readRecord(error);
    if (!record) return undefined;
    return this.structuralProjector.project(
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
    const tokenProjection = this.jsonProjector.project(structural.value, rule.maxTokens);
    const tokenOmitted = tokenProjection.complete ? 0 : 1;
    return {
      key,
      value: tokenProjection.value,
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
    }
  }
}

function sourceView(input: {
  complete: boolean;
  omissionCount: number;
  omissions: readonly AgentToolObservationProjectionOmission[];
  artifactUri: string | undefined;
  manifest: AgentToolObservationProjectionManifest;
}): AgentUnknownRecord {
  return {
    type: AgentPiToolObservationSourceViewProtocol.type,
    complete: input.complete,
    omission_count: input.omissionCount,
    omissions: input.omissions,
    artifact_fallback: {
      strategy: input.manifest.artifactFallback.strategy,
      required_when_truncated: input.manifest.artifactFallback.requiredWhenTruncated,
      available: input.artifactUri !== undefined,
    },
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

function appendTokenOmission(view: AgentUnknownRecord, maxOmissions: number): AgentUnknownRecord {
  const omissions = Array.isArray(view.omissions) ? view.omissions : [];
  const alreadyRecorded = omissions.some(
    (omission) =>
      readRecord(omission)?.path === "/detail" &&
      readRecord(omission)?.reason === AgentToolObservationOmissionReasons.TokenLimit,
  );
  return {
    ...view,
    complete: false,
    omission_count: Number(view.omission_count ?? 0) + (alreadyRecorded ? 0 : 1),
    omissions: alreadyRecorded
      ? omissions
      : [...omissions, { path: "/detail", reason: AgentToolObservationOmissionReasons.TokenLimit }].slice(
          0,
          maxOmissions,
        ),
  };
}

function escapeJsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function normalizePositiveInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
