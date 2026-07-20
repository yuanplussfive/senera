import type {
  AgentToolProcessResponseType,
  AgentToolProcessResponseVersion,
} from "../ToolRuntime/AgentToolProcessEnvelope.js";
import type { RegisteredTool } from "./PluginRuntimeTypes.js";
import type { ToolArtifactPolicyManifest } from "./PluginManifestTypes.js";
import type { AgentToolResultSummary } from "./AgentToolResultSummaryTypes.js";
import type { SeneraOutputSpoolDescriptor } from "../Execution/SeneraOutputSpool.js";

export interface ExecutedToolCallResult {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  process: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
  };
  outputCapture?: SeneraOutputSpoolDescriptor;
  result: unknown;
  artifact?: ExecutedToolCallArtifact;
  presentation?: AgentToolResultPresentation;
  artifactPolicy?: ToolArtifactPolicyManifest;
  workspaceCapture?: ToolWorkspaceCaptureResult;
}

export const AgentToolResultPresentationType = "senera.tool_result_presentation.v1";

export type AgentToolResultPresentationStatus = "success" | "failure" | "empty";

/**
 * User-facing projection of a tool result. The raw result remains on
 * ExecutedToolCallResult.result for inspection and model observation.
 */
export interface AgentToolResultPresentation {
  type: typeof AgentToolResultPresentationType;
  version: 1;
  status: AgentToolResultPresentationStatus;
  headline: string;
  summary?: string;
  facts: AgentToolResultPresentationFact[];
  evidence: AgentToolResultPresentationEvidence[];
  changes: AgentToolResultPresentationChange[];
  artifactUri?: string;
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
  registry: AgentPluginRegistryLike;
}

export interface AgentPluginRegistryLike {
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
    pluginName?: string;
    toolName?: string;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    [key: string]: unknown;
  };
}

export interface AgentToolProcessResponse {
  type: AgentToolProcessResponseType;
  version: AgentToolProcessResponseVersion;
  ok: boolean;
  result?: unknown;
  error?: AgentToolProcessError;
}
