import type {
  AgentToolProcessResponseType,
  AgentToolProcessResponseVersion,
} from "../ToolRuntime/AgentToolProcessEnvelope.js";
import type { RegisteredTool } from "./AgentToolRuntimeTypes.js";
import type { RegisteredSkill } from "../Skills/AgentSkillTypes.js";
import {
  ToolResultStorageModes,
  type ToolArtifactPolicyManifest,
  type ToolResultStorageMode,
} from "./AgentToolContractTypes.js";
import type { AgentToolResultSummary } from "./AgentToolResultSummaryTypes.js";
import type { SeneraOutputSpoolDescriptor } from "../Execution/SeneraOutputSpool.js";
import type { AgentToolExecutionPlan } from "../ToolRuntime/AgentToolExecutionPlan.js";
import type {
  AgentToolAssessmentStatus,
  AgentToolExecutionOutcome,
  AgentToolFailure,
} from "../ToolRuntime/AgentToolResultOutcome.js";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import type { AgentToolEventOrigin } from "../ToolRuntime/AgentToolEventOrigin.js";
import type { AgentWorkspaceContinuityCheckpoint } from "../Continuity/AgentContinuityLedger.js";
import type { AgentResourceReference } from "../Resources/AgentResourceReference.js";

export const AgentWorkspaceMutationReceiptProtocol = defineSeneraProtocol("workspace_mutation_receipt", 1);
export const AgentWorkspaceChangeSetProtocol = defineSeneraProtocol("workspace_change_set", 1);
export const AgentArtifactBackedToolResultProtocol = defineSeneraProtocol("artifact_backed_tool_result", 1);
const AgentToolSourceViewResultProtocol = defineSeneraProtocol("source_view_tool_result", 1);

export type ToolWorkspaceChangeSource = "mutation-receipt" | "filesystem-observer";
export type ToolWorkspaceChangeCoverage = "exact" | "observed";

export type AgentWorkspaceObservationLeaseState = "active" | "completed";

export interface AgentWorkspaceObservationLeaseSignal {
  readonly resourceId: string;
  readonly state: AgentWorkspaceObservationLeaseState;
}

/**
 * Internal runtime evidence emitted by a host capability that owns a file
 * mutation. It never becomes part of the tool's public result schema.
 */
export interface AgentWorkspaceMutationReceipt {
  readonly type: typeof AgentWorkspaceMutationReceiptProtocol.type;
  readonly version: typeof AgentWorkspaceMutationReceiptProtocol.version;
  /** A logical timestamp for the complete committed mutation transaction. */
  readonly capturedAt: string;
  /**
   * Exact transaction images supplied by the writer that performed the
   * mutation. These are host-only bytes, never a public tool-result field.
   */
  readonly entries: readonly AgentWorkspaceMutationReceiptEntry[];
}

export interface AgentWorkspaceMutationReceiptEntry {
  readonly path: string;
  readonly before: AgentWorkspaceMutationReceiptImage;
  readonly after: AgentWorkspaceMutationReceiptImage;
}

export type AgentWorkspaceMutationReceiptImage =
  { readonly kind: "missing" } | { readonly kind: "directory" } | { readonly kind: "file"; readonly bytes: Uint8Array };

export interface AgentToolArtifactAsset {
  readonly id: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly dataBase64: string;
}

/**
 * A bounded, host-generated or adapter-generated provenance hint. It is not
 * the raw tool result; the raw result remains in the published artifact.
 */
export interface AgentToolEvidenceCandidate {
  readonly key?: string;
  readonly kind: string;
  readonly locator: string;
  readonly display: string;
  readonly label?: string;
  readonly source?: string;
  readonly confidence?: number;
  readonly facts?: readonly {
    readonly name: string;
    readonly value: unknown;
  }[];
  readonly artifactRefs?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentToolArtifactPayload {
  /**
   * Redacted and durable-only source response. It is never included in the
   * immediate model result when the adapter can provide a bounded projection.
   */
  readonly rawResponse?: unknown;
  /** Binary or otherwise non-inline material referenced by the model result. */
  readonly assets?: readonly AgentToolArtifactAsset[];
  /** Bounded provenance hints; the complete response remains the Artifact. */
  readonly evidence?: readonly AgentToolEvidenceCandidate[];
}

/** A canonical coordinate in an already durable source Artifact. */
export interface AgentToolSourceArtifactReference {
  readonly artifactUri: string;
  readonly refs: readonly string[];
}

export interface AgentArtifactBackedToolResultReference {
  readonly type: typeof AgentArtifactBackedToolResultProtocol.type;
  readonly version: typeof AgentArtifactBackedToolResultProtocol.version;
  readonly artifactUri: string;
  readonly refs?: readonly string[];
}

/** Compact history value for a bounded read of an existing Artifact. */
interface AgentToolSourceViewResultReference {
  readonly type: typeof AgentToolSourceViewResultProtocol.type;
  readonly version: typeof AgentToolSourceViewResultProtocol.version;
  readonly sourceArtifacts: readonly AgentToolSourceArtifactReference[];
}

/**
 * Artifact persistence is an auxiliary durability concern. It must never
 * change the execution outcome that was returned by the tool runtime.
 */
export const AgentToolArtifactAvailabilityStatuses = {
  Unavailable: "unavailable",
} as const;

export const AgentToolArtifactUnavailableReasons = {
  RecordingFailed: "recording_failed",
} as const;

export interface AgentToolArtifactAvailability {
  readonly status: typeof AgentToolArtifactAvailabilityStatuses.Unavailable;
  readonly reason: typeof AgentToolArtifactUnavailableReasons.RecordingFailed;
}

export interface AgentToolArtifactAssetReference {
  readonly id: string;
  readonly resourceUri: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly relativePath: string;
  readonly workspacePath: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface ExecutedToolCallResult {
  callId: string;
  name: string;
  origin?: AgentToolEventOrigin;
  arguments: Record<string, unknown>;
  execution?: AgentToolExecutionPlan;
  process: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  };
  artifactPayload?: AgentToolArtifactPayload;
  artifactAvailability?: AgentToolArtifactAvailability;
  outputCapture?: SeneraOutputSpoolDescriptor;
  /** Declarative result persistence policy copied from the registered tool. */
  resultStorage?: ToolResultStorageMode;
  /** Original Artifact coordinates for a SourceView result. */
  sourceArtifacts?: readonly AgentToolSourceArtifactReference[];
  result: unknown;
  outcome: AgentToolExecutionOutcome;
  artifact?: ExecutedToolCallArtifact;
  presentation?: AgentToolResultPresentation;
  artifactPolicy?: ToolArtifactPolicyManifest;
  workspaceCapture?: ToolWorkspaceCaptureResult;
  /** Internal handoff state for a resource-backed workspace observation. */
  workspaceObservation?: AgentWorkspaceObservationLeaseSignal;
}

export function isAgentToolResultSourceView(result: Pick<ExecutedToolCallResult, "resultStorage">): boolean {
  return result.resultStorage === ToolResultStorageModes.SourceView;
}

/** Shared compact SourceView value for session history and lifecycle events. */
export function projectAgentToolSourceViewResultReference(
  result: Pick<ExecutedToolCallResult, "resultStorage" | "sourceArtifacts">,
): AgentToolSourceViewResultReference | undefined {
  if (!isAgentToolResultSourceView(result) || !result.sourceArtifacts || result.sourceArtifacts.length === 0) {
    return undefined;
  }
  return {
    type: AgentToolSourceViewResultProtocol.type,
    version: AgentToolSourceViewResultProtocol.version,
    sourceArtifacts: result.sourceArtifacts,
  };
}

/** Keeps durable results compact in history; their complete payload lives in Artifacts. */
export function projectAgentToolResultForHistory(result: ExecutedToolCallResult): ExecutedToolCallResult {
  const { workspaceObservation: _workspaceObservation, ...historyResult } = result;
  const sourceView = projectAgentToolSourceViewResultReference(result);
  if (sourceView) return { ...historyResult, result: sourceView };
  if (historyResult.artifact) {
    const refs = historyResult.artifact.structuredSummary?.retrieval.refs ?? [];
    const artifactReference: AgentArtifactBackedToolResultReference = {
      type: AgentArtifactBackedToolResultProtocol.type,
      version: AgentArtifactBackedToolResultProtocol.version,
      artifactUri: historyResult.artifact.artifactUri,
      ...(refs.length > 0 ? { refs: [...refs] } : {}),
    };
    return { ...historyResult, result: artifactReference };
  }
  return historyResult;
}

export const AgentToolResultPresentationProtocol = defineSeneraProtocol("tool_result_presentation", 1);

export type AgentToolResultPresentationStatus = AgentToolAssessmentStatus;

/**
 * User-facing projection of a tool result. Small results remain inline;
 * Artifact-backed results retain their complete payload in the Artifact and
 * carry a compact retrieval reference through runtime state.
 */
export interface AgentToolResultPresentation {
  type: typeof AgentToolResultPresentationProtocol.type;
  version: typeof AgentToolResultPresentationProtocol.version;
  status: AgentToolResultPresentationStatus;
  headline: string;
  summary?: string;
  facts: AgentToolResultPresentationFact[];
  evidence: AgentToolResultPresentationEvidence[];
  changes: AgentToolResultPresentationChange[];
  /** Resources produced by the tool; availability never implies publication. */
  resources?: readonly AgentResourceReference[];
  artifactUri?: string;
  /** Host-owned workspace observation status for producer-independent UI. */
  workspaceObservation?: AgentToolResultPresentationWorkspaceObservation;
  /** Compact workspace handoff coordinates; file contents remain in the Artifact. */
  workspaceCheckpoint?: AgentWorkspaceContinuityCheckpoint;
  artifactAvailability?: AgentToolArtifactAvailability;
  failure?: AgentToolFailure;
}

export interface AgentToolResultPresentationWorkspaceObservation {
  status: "complete" | "partial";
  /** `bounded` is an intentional capture limit; `degraded` means accuracy is not guaranteed. */
  quality?: "complete" | "bounded" | "degraded";
  /** Primary source used to discover workspace changes. */
  source?: ToolWorkspaceChangeSource;
  /** Historical multi-source capture metadata, retained for old Artifacts. */
  sources?: readonly ToolWorkspaceChangeSource[];
  /** Proof quality is independent from preview and content truncation. */
  coverage?: ToolWorkspaceChangeCoverage;
  scope?: ToolWorkspaceCaptureResult["scope"];
  beforeEntryCount: number;
  afterEntryCount: number;
  changedFileCount: number;
  /** Directory changes stay visible in batch summaries but never become file artifacts. */
  changedDirectoryCount?: number;
  warningCount: number;
  warnings?: readonly string[];
}

export interface AgentToolResultPresentationFact {
  name: string;
  value: string;
  kind?: string;
  evidenceUri?: string;
  confidence?: number;
}

export interface AgentToolResultPresentationEvidence {
  evidenceUri: string;
  kind: string;
  display: string;
  label: string;
  source: string;
  locator: string;
  confidence: number;
}

export interface AgentToolResultPresentationChange {
  kind: string;
  status: "added" | "changed" | "unchanged";
  key: string;
  summary: string;
  /** Workspace changes retain their filesystem status for UI projections. */
  workspaceStatus?: ToolWorkspaceChange["status"];
  /**
   * Preserve the snapshot entry kinds at the presentation boundary. A
   * workspace snapshot includes directories for recovery and type changes,
   * but they are not file artifacts and must not be counted as such by UI
   * projections.
   */
  workspaceBeforeKind?: ToolWorkspaceFileSnapshot["kind"];
  workspaceAfterKind?: ToolWorkspaceFileSnapshot["kind"];
  addedLines?: number;
  removedLines?: number;
}

export interface ExecutedToolCallArtifact {
  artifactId: string;
  artifactUri: string;
  artifactPath: string;
  relativePath: string;
  manifestPath: string;
  files: Record<string, string>;
  assets?: readonly AgentToolArtifactAssetReference[];
  summary: string;
  projection?: string;
  structuredSummary?: AgentToolResultSummary;
  evidence: ToolArtifactEvidenceRecord[];
  delta: ToolArtifactDeltaRecord[];
  workspace?: ToolWorkspaceCaptureResult;
}

export interface ToolWorkspaceCaptureResult {
  /** Versioned ChangeSet identity for new artifacts; omitted by historical captures. */
  type?: typeof AgentWorkspaceChangeSetProtocol.type;
  version?: typeof AgentWorkspaceChangeSetProtocol.version;
  /** The transaction proof that established the before/after images. */
  source?: ToolWorkspaceChangeSource;
  /** Historical multi-source capture metadata, retained for old Artifacts. */
  sources?: readonly ToolWorkspaceChangeSource[];
  /** Proof quality is separate from preview and content limits. */
  coverage?: ToolWorkspaceChangeCoverage;
  before: ToolWorkspaceSnapshot;
  after: ToolWorkspaceSnapshot;
  changes: ToolWorkspaceChange[];
  /** Historical observation quality; new receipt ChangeSets use `coverage`. */
  status?: "complete" | "bounded" | "degraded";
  /** Observed filesystem changes are scoped to either a tool batch or a resource lease. */
  scope?: { readonly kind: "tool_batch"; readonly id: string } | { readonly kind: "resource"; readonly id: string };
  /** Legacy observer revision retained only for historical artifact reads. */
  revision?: number;
  checkpoint?: AgentWorkspaceContinuityCheckpoint;
}

export interface ToolWorkspaceSnapshot {
  files: ToolWorkspaceFileSnapshot[];
  capturedAt: string;
  /** Historical snapshot metadata, retained for old checkpoint restoration. */
  status?: "complete" | "bounded" | "degraded";
  revision?: number;
  /** Historical scanner diagnostics. New receipts never emit these. */
  warnings?: string[];
}

export interface ToolWorkspaceFileSnapshot {
  path: string;
  absolutePath: string;
  exists: boolean;
  kind: "file" | "directory" | "missing" | "other" | "symlink";
  size: number;
  mtimeMs: number;
  hash: string;
  content?: ToolWorkspaceFileContentSnapshot;
  target?: string;
}

export type ToolWorkspaceFileContentSnapshot =
  | {
      state: "captured";
      encoding: "utf8";
      byteLength: number;
      lineCount: number;
      text?: string;
      artifactPath?: string;
      relativeArtifactPath?: string;
    }
  | {
      state: "omitted";
      reason:
        | "missing"
        | "directory"
        | "size_limit"
        | "cache_limit"
        | "binary"
        | "not_requested"
        | "unsupported"
        | "unreadable";
      byteLength?: number;
    };

export interface ToolWorkspaceChangePatch {
  status: "generated" | "skipped";
  reason?: string;
  path?: string;
  relativePath?: string;
}

export interface ToolWorkspaceChange {
  path: string;
  absolutePath: string;
  status: "added" | "modified" | "deleted" | "unchanged" | "type_changed";
  beforeKind: ToolWorkspaceFileSnapshot["kind"];
  afterKind: ToolWorkspaceFileSnapshot["kind"];
  beforeHash: string;
  afterHash: string;
  beforeSize: number;
  afterSize: number;
  addedLines?: number;
  removedLines?: number;
  patch?: ToolWorkspaceChangePatch;
}

export interface ToolArtifactEvidenceRecord {
  key: string;
  evidenceUri: string;
  kind: string;
  locator: string;
  display: string;
  label: string;
  source: string;
  confidence: number;
  slots?: Record<string, unknown>;
  modelSlots: ToolArtifactEvidenceModelSlotRecord[];
  plannerMemory: ToolArtifactEvidencePlannerMemoryRecord;
  metadata?: Record<string, unknown>;
}

export interface ToolArtifactEvidenceModelSlotRecord {
  name: string;
  value: string;
}

export interface ToolArtifactEvidencePlannerMemoryRecord {
  facts: ToolArtifactEvidenceModelSlotRecord[];
  artifactRefs: string[];
  artifactUri?: string;
}

export interface ToolArtifactDeltaRecord {
  kind: string;
  key: string;
  status: "added" | "changed" | "unchanged";
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionContext {
  tool: RegisteredTool;
  arguments: Record<string, unknown>;
  registry: AgentExtensionRegistryLike;
}

export interface AgentExtensionRegistryLike {
  getTool(name: string): RegisteredTool | undefined;
  listTools?(): readonly RegisteredTool[];
  getSkill?(name: string): RegisteredSkill | undefined;
  listSkills?(): readonly RegisteredSkill[];
}

export interface AgentToolProcessError {
  code: import("../Xml/AgentXmlStatus.js").AgentExecutionErrorCode;
  message: string;
  diagnostics?: import("../Diagnostics/AgentSourceDiagnostic.js").AgentSourceDiagnostic[];
  details?: {
    phase?: import("../Xml/AgentXmlStatus.js").AgentToolProcessErrorPhase;
    issues?: unknown;
    runtime?: string;
    timeoutMs?: number;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
    actualBytes?: number;
    extensionName?: string;
    toolName?: string;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    [key: string]: unknown;
  };
}

export type AgentToolProcessResponse =
  | {
      type: AgentToolProcessResponseType;
      version: AgentToolProcessResponseVersion;
      ok: true;
      result?: unknown;
      error?: never;
    }
  | {
      type: AgentToolProcessResponseType;
      version: AgentToolProcessResponseVersion;
      ok: false;
      result?: never;
      error: AgentToolProcessError;
    };
