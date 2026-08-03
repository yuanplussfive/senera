import type {
  AgentToolProcessResponseType,
  AgentToolProcessResponseVersion,
} from "../ToolRuntime/AgentToolProcessEnvelope.js";
import type { RegisteredTool } from "./AgentToolRuntimeTypes.js";
import type { ToolArtifactPolicyManifest } from "./AgentToolContractTypes.js";
import type { AgentToolResultSummary } from "./AgentToolResultSummaryTypes.js";
import type { SeneraOutputSpoolDescriptor } from "../Execution/SeneraOutputSpool.js";
import type { AgentToolExecutionPlan } from "../ToolRuntime/AgentToolExecutionPlan.js";
import type {
  AgentToolAssessmentStatus,
  AgentToolExecutionOutcome,
  AgentToolFailure,
} from "../ToolRuntime/AgentToolResultOutcome.js";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";

export interface ExecutedToolCallResult {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  execution?: AgentToolExecutionPlan;
  process: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  };
  outputCapture?: SeneraOutputSpoolDescriptor;
  result: unknown;
  outcome: AgentToolExecutionOutcome;
  artifact?: ExecutedToolCallArtifact;
  presentation?: AgentToolResultPresentation;
  artifactPolicy?: ToolArtifactPolicyManifest;
  workspaceCapture?: ToolWorkspaceCaptureResult;
}

export const AgentToolResultPresentationProtocol = defineSeneraProtocol("tool_result_presentation", 1);

export type AgentToolResultPresentationStatus = AgentToolAssessmentStatus;

/**
 * User-facing projection of a tool result. The raw result remains on
 * ExecutedToolCallResult.result for inspection and model observation.
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
  artifactUri?: string;
  failure?: AgentToolFailure;
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
}

export interface ExecutedToolCallArtifact {
  artifactId: string;
  artifactUri: string;
  artifactPath: string;
  relativePath: string;
  manifestPath: string;
  files: Record<string, string>;
  summary: string;
  projection?: string;
  structuredSummary?: AgentToolResultSummary;
  evidence: ToolArtifactEvidenceRecord[];
  delta: ToolArtifactDeltaRecord[];
  workspace?: ToolWorkspaceCaptureResult;
}

export interface ToolWorkspaceCaptureResult {
  before: ToolWorkspaceSnapshot;
  after: ToolWorkspaceSnapshot;
  changes: ToolWorkspaceChange[];
}

export interface ToolWorkspaceSnapshot {
  files: ToolWorkspaceFileSnapshot[];
  capturedAt: string;
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
      reason: "missing" | "directory" | "size_limit" | "binary" | "not_requested" | "unsupported";
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
