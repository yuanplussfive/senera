import type {
  AgentToolProcessResponseType,
  AgentToolProcessResponseVersion,
} from "../AgentToolProcessEnvelope.js";
import type {
  RegisteredAgent,
  RegisteredAgentContextPack,
  RegisteredAgentMergePolicy,
  RegisteredAgentWorkflow,
  RegisteredTool,
} from "./PluginRuntimeTypes.js";
import type { ToolArtifactPolicyManifest } from "./PluginManifestTypes.js";

export type AgentDecision =
  {
    kind: "ToolCalls";
    root: string;
    source: AgentDecisionSource;
    payload: ToolCallsDecision;
  };

export interface AgentDecisionSource {
  xml: string;
}

export interface ToolCallsDecision {
  tool_call: ToolCallDecision[];
}

export interface ToolCallDecision {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ExecutedToolCallResult {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  process: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
  };
  result: unknown;
  artifact?: ExecutedToolCallArtifact;
  artifactPolicy?: ToolArtifactPolicyManifest;
  workspaceCapture?: ToolWorkspaceCaptureResult;
}

export interface ExecutedToolCallArtifact {
  artifactId: string;
  artifactUri: string;
  artifactPath: string;
  relativePath: string;
  manifestPath: string;
  files: Record<string, string>;
  summary: string;
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
  getAgent?(name: string): RegisteredAgent | undefined;
  getAgentWorkflow?(name: string): RegisteredAgentWorkflow | undefined;
  getAgentContextPack?(name: string): RegisteredAgentContextPack | undefined;
  getAgentMergePolicy?(name: string): RegisteredAgentMergePolicy | undefined;
  listAgentWorkflows?(): RegisteredAgentWorkflow[];
}

export interface AgentToolProcessRequest {
  tool: string;
  arguments: Record<string, unknown>;
  context: AgentToolProcessContext;
}

export interface AgentToolProcessContext {
  workspaceRoot: string;
  pluginRoot: string;
}

export interface AgentToolProcessError {
  code: import("../AgentXmlStatus.js").AgentExecutionErrorCode;
  message: string;
  diagnostics?: import("../AgentSourceDiagnostic.js").AgentSourceDiagnostic[];
  details?: {
    phase?: import("../AgentXmlStatus.js").AgentToolProcessErrorPhase;
    issues?: unknown;
    modulePath?: string;
    runtime?: string;
    timeoutMs?: number;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
    actualBytes?: number;
    type?: unknown;
    version?: unknown;
    expectedType?: string;
    expectedVersion?: number;
    receivedLine?: string;
    parseError?: string;
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
