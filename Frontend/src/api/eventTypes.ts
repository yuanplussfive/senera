// 协议类型。事件枚举从后端 AgentEventCatalog 生成，其他 DTO 保持前端消费视角。
import { EventChannels, EventKinds, EventLayers, EventPhases } from "./generatedEventCatalog";
import type { EventChannel, EventKind, EventLayer, EventPhase } from "./generatedEventCatalog";
import type { ProviderModelConfigOperationKind } from "./providerModelCommandTypes";
import type { FrontendLocalizedText } from "../i18n/frontendLocaleModel";
import type { BackendLocalizedMessage } from "../i18n/backendMessage";
import type {
  AgentToolResultPresentation,
  AgentToolResultPresentationChange,
  AgentToolResultPresentationEvidence,
  AgentToolResultPresentationFact,
} from "../../../Source/AgentSystem/Types/ToolRuntimeTypes";

export type {
  ConfigCommandRequestInput,
  ConfigRevisionGuardRequestInput,
  ProviderModelBulkImportGroupAssignmentInput,
  ProviderModelConfigInput,
  ProviderModelConfigCommandDraft,
  ProviderModelConfigOperationKind,
  ProviderModelConfigRequest,
  ProviderModelEndpointInput,
  ProviderModelEndpointPatchInput,
  ProviderModelEndpointKind,
  ProviderModelGroupAssignmentInput,
} from "./providerModelCommandTypes";

export type {
  InteractionInputAction,
  InteractionInputContent,
  InteractionInputProperty,
  InteractionInputRequestedData,
  InteractionInputResolvedData,
  InteractionInputSchema,
  InteractionInputValue,
} from "./interactionInputEventTypes";

export type { RequestInvalidData, RunCancellationProgressData } from "./runControlEventTypes";

export { EventChannels, EventKinds, EventLayers, EventPhases };
export type { EventChannel, EventKind, EventLayer, EventPhase } from "./generatedEventCatalog";

export interface EventEnvelope<TKind extends string = EventKind, TData = unknown> {
  eventId?: string;
  channel: EventChannel;
  kind: TKind;
  layer: EventLayer;
  phase: EventPhase;
  sequence: number;
  timestamp: string;
  sessionId?: string;
  requestId?: string;
  step?: number;
  scope?: EventScope;
  detailId?: string;
  data: TData;
}

export interface EventScope {
  parentRequestId?: string;
  workflowName?: string;
  jobId?: string;
  agentName?: string;
  role?: "childAgent" | "merge";
}

export interface SystemToolSettingsItem {
  name: string;
  title: string;
  description: string;
  extension: string;
  loading: string;
}

export interface SystemExtensionToolSettingsItem {
  name: string;
  description: string;
  loading: string;
  capability: string;
}

export interface SystemExtensionConfigurationSettings {
  configured: boolean;
  value: Record<string, unknown>;
  effectiveValue: Record<string, unknown>;
  defaults: Record<string, unknown>;
  sections: ConfigFormSectionData<FrontendLocalizedText>[];
}

export interface SystemExtensionSettingsItem {
  id: string;
  version: string;
  displayName: FrontendLocalizedText;
  description: FrontendLocalizedText;
  enabled: boolean;
  configured: boolean;
  priority?: number;
  tools: SystemExtensionToolSettingsItem[];
  skillCount: number;
  mcpServerCount: number;
  configuration?: SystemExtensionConfigurationSettings;
}

export interface SystemToolSnapshotData {
  extensions: SystemExtensionSettingsItem[];
  tools: SystemToolSettingsItem[];
}

export type McpInputValue = string | number | boolean | string[] | number[] | boolean[];

export interface McpInputStatus {
  id: string;
  title: string;
  description?: string;
  type: "string" | "number" | "boolean" | "filepath" | "directory";
  required: boolean;
  secret: boolean;
  multiple: boolean;
  configured: boolean;
  stored: boolean;
  source: "vault" | "configuration" | "environment" | "oauth" | "default" | "missing";
  provenance: "mcpb" | "registry" | "legacy" | "connection";
  value?: McpInputValue;
  defaultValue?: McpInputValue;
  choices?: McpInputValue[];
  placeholder?: string;
  min?: number;
  max?: number;
  updatedAt?: string;
}

export interface McpServerSettingsItem {
  id: string;
  packageName: string;
  source: "bundled" | "workspace";
  descriptorKind: "mcpb" | "registry" | "legacy" | "connection";
  transport: "stdio" | "http";
  status: "configured" | "needs_input";
  inputs: McpInputStatus[];
}

export interface McpServerSnapshotData {
  servers: McpServerSettingsItem[];
  operation?: { requestId: string; kind: "mcp_input_update" };
}

export interface McpInputMutationState {
  requestId: string;
  status: "pending" | "success" | "error";
  message?: string;
}

// --- 各 kind 的 data 形状（只列前端会读的字段） ---

export interface SessionSnapshotData {
  sessionId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  entryCount: number;
  messageCount: number;
  turnCount: number;
  activeRequestId?: string;
}

export interface SessionListItem {
  sessionId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  entryCount: number;
  messageCount: number;
  activeRequestId?: string;
}

export interface SessionListSnapshotData {
  sessions: SessionListItem[];
}

export interface SessionNotFoundData {
  sessionId: string;
  operation:
    | "session.message"
    | "session.close"
    | "session.history"
    | "session.fork"
    | "session.compact"
    | "session.runtime_status"
    | "session.export";
  message: string;
  localizedMessage?: BackendLocalizedMessage;
}

export interface SessionForkedData {
  sessionId: string;
  sourceSessionId: string;
  throughRequestId: string;
  title: string;
  createdAt: string;
}

export interface SessionCompactedData {
  sessionId: string;
  tokensBefore: number;
  estimatedTokensAfter?: number;
}

export interface SessionRuntimeStatusData {
  sessionId: string;
  available: boolean;
  runtime?: {
    sessionId: string;
    cached: boolean;
    stats: {
      userMessages: number;
      assistantMessages: number;
      toolCalls: number;
      toolResults: number;
      totalMessages: number;
      tokens: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        total: number;
      };
      cost: number;
      contextUsage?: SessionContextUsage;
    };
    contextUsage?: SessionContextUsage;
  };
}

export interface SessionContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface SessionExportedData {
  sessionId: string;
  format: "jsonl" | "html";
  path: string;
}

export interface SessionBusyData {
  sessionId: string;
  activeRequestId: string;
  rejectedRequestId?: string;
  operation: "session.message" | "session.close";
  message: string;
  localizedMessage?: BackendLocalizedMessage;
}

export type ConversationEntryDto =
  | {
      id: string;
      requestId: string;
      timestamp: string;
      kind: "user.message";
      content: string;
      attachments?: UploadAttachmentData[];
      metadata?: ConversationEntryMetadata;
    }
  | {
      id: string;
      requestId: string;
      timestamp: string;
      kind: "assistant.decision";
      xml: string;
      metadata?: ConversationEntryMetadata;
    }
  | {
      id: string;
      requestId: string;
      timestamp: string;
      kind: "context.tool_results";
      xml: string;
      metadata?: ConversationEntryMetadata;
    };

export interface SessionHistoryStartedData {
  sessionId: string;
  totalEntries: number;
  messageCount: number;
  refresh?: boolean;
}

export interface SessionHistoryChunkData {
  sessionId: string;
  entries: Array<{
    entry: ConversationEntryDto;
    visible?: { kind: string; text: string };
  }>;
}

export interface SessionRunHistoryChunkData {
  sessionId: string;
  events: EventEnvelope[];
}

export interface SessionHistoryCompletedData {
  sessionId: string;
  refresh?: boolean;
}

/** 精简档执行步骤轨迹（与后端 StepTrace 对齐）；回放时重建 run.steps */
export interface StepTraceDto {
  step: number;
  seq: number;
  kind: "decision" | "tool" | "retry" | "answer";
  decisionKind?: string;
  toolName?: string;
  callId?: string;
  batchId?: string;
  status: "done" | "failed";
  startedAt?: string;
  endedAt?: string;
  title?: string;
  toolArgs?: unknown;
  toolPreview?: string;
  toolPresentation?: ToolResultPresentation;
  toolResult?: unknown;
  toolErrorMessage?: string;
  errorMessage?: string;
  retryCode?: string;
}

export interface SessionHistoryStepsData {
  sessionId: string;
  runs: Array<{
    requestId: string;
    input: string;
    startedAt: string;
    endedAt?: string;
    status: "running" | "completed" | "failed" | "cancelled";
    modelProvider?: ModelProviderMetadata;
    traces: StepTraceDto[];
  }>;
}

export interface ModelProviderMetadata {
  id: string;
  kind: string;
  endpoint: string;
  baseUrl: string;
  model: string;
}

export interface ModelProviderListItem {
  id: string;
  icon?: string;
  capabilities: ModelCapabilitiesData;
  kind: string;
  endpoint: string;
  baseUrl: string;
  model: string;
  isDefault: boolean;
}

export interface ModelCapabilitiesData {
  Chat?: boolean;
  Embedding?: boolean;
  Rerank?: boolean;
  Vision?: boolean;
  ImageOutput?: boolean;
  Reasoning?: boolean;
  ToolCalling?: boolean;
  DeveloperRole?: boolean;
  StreamingUsage?: boolean;
}

export type ToolResultPresentation = Omit<AgentToolResultPresentation, "failure">;
export type ToolResultPresentationFact = AgentToolResultPresentationFact;
export type ToolResultPresentationEvidence = AgentToolResultPresentationEvidence;
export type ToolResultPresentationChange = AgentToolResultPresentationChange;

export interface ModelListSnapshotData {
  models: ModelProviderListItem[];
  defaultModelProviderId: string;
}

export interface ProviderModelInfo {
  id: string;
  ownedBy?: string;
}

export interface ProviderModelsSnapshotData {
  providerId: string;
  baseUrl: string;
  fetchedAt: string;
  source: "cache" | "network";
  models: ProviderModelInfo[];
}

export interface ProviderModelsFailedData {
  providerId: string;
  message: string;
  localizedMessage?: BackendLocalizedMessage;
  details?: unknown;
}

export type {
  SandboxDependencySnapshotData,
  SandboxDiagnosticData,
  SandboxEffectiveMode,
  SandboxPreparationProgressData,
  SandboxPreparationStage,
  SandboxRuntimeState,
  SandboxStatusSnapshotData,
} from "./sandboxRuntimeEventTypes";

export type PresetFormat = "json" | "markdown" | "text";

export interface PresetDiagnostic {
  severity: "error" | "warning";
  message: string;
}

export interface PresetItem {
  name: string;
  format: PresetFormat;
  title: string;
  sizeBytes: number;
  updatedAt: string;
  active: boolean;
  content: string;
  diagnostics: PresetDiagnostic[];
}

export type PresetOperationKind = "list" | "save" | "delete" | "set_active";

export interface PresetOperationResult {
  requestId?: string;
  kind: PresetOperationKind;
  name?: string | null;
}

export interface PresetSnapshotData {
  enabled: boolean;
  rootDir: string;
  activePresetName: string | null;
  presets: PresetItem[];
  operation?: PresetOperationResult;
}

export interface PresetFailedData {
  message: string;
  localizedMessage?: BackendLocalizedMessage;
  details?: unknown;
  operation?: PresetOperationResult;
}

export interface ConfigFailedData {
  configPath: string;
  message: string;
  localizedMessage?: BackendLocalizedMessage;
  details?: unknown;
  operation?: ConfigOperationResult;
}

export type ConfigSnapshotSource = "sqlite" | "json";

export type ConfigOperationKind = "config_update" | ProviderModelConfigOperationKind;

export interface ConfigOperationResult {
  commandId: string;
  kind: ConfigOperationKind;
}

export interface ConfigDiagnosticData {
  severity: "warning" | "error";
  message: string;
  details?: unknown;
}

export type ConfigFormFieldType = "boolean" | "string" | "number" | "array" | "table" | "record";

export type ConfigFormFieldOptionValue = string | number | boolean;

export type ConfigFormValueSource = "explicit" | "inherited" | "default" | "missing";

export type ConfigFormModelCapability =
  "Chat" | "Embedding" | "Rerank" | "Vision" | "ImageOutput" | "Reasoning" | "DeveloperRole" | "StreamingUsage";

export interface ConfigFormModelSelectionData {
  id: string;
  capability: ConfigFormModelCapability;
  valueKind: "model-id" | "provider-model";
  mutation: "config" | "default-model";
  providerPath?: string[];
  required: boolean;
}

export interface ConfigFormSnapshotData {
  version: 1;
  sections: ConfigFormSectionData[];
}

export interface ConfigFormSectionData<TText = string> {
  name: string;
  label: TText;
  description?: TText;
  icon?: string;
  keyCount: number;
  fields: ConfigFormFieldData<TText>[];
}

export interface ConfigFormFieldData<TText = string> {
  label: TText;
  section: string;
  key: string;
  path: string[];
  type: ConfigFormFieldType;
  itemType?: ConfigFormFieldType;
  value: unknown;
  effectiveValue: unknown;
  configured: boolean;
  missing: boolean;
  valueSource: ConfigFormValueSource;
  description?: TText;
  placeholder?: TText;
  options?: ConfigFormFieldOptionValue[];
  optionLabels?: Record<string, string>;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  step?: number;
  secret?: boolean;
  multiline?: boolean;
  required: boolean;
  essential: boolean;
  addLabel?: string;
  itemLabelPath?: string[];
  itemFields?: ConfigFormFieldData<TText>[];
  defaultValue?: unknown;
  defaultItem?: Record<string, unknown>;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  modelSelection?: ConfigFormModelSelectionData;
}

export interface ConfigSnapshotData {
  path: string;
  version: number;
  value: Record<string, unknown>;
  source: ConfigSnapshotSource;
  revision?: number;
  diagnostics: ConfigDiagnosticData[];
  form: ConfigFormSnapshotData;
  operation?: ConfigOperationResult;
}

export type MutationStatus = "pending" | "success" | "error";

export interface ConfigMutationState {
  commandId: string;
  kind: ConfigOperationKind;
  status: MutationStatus;
  message?: string;
  errorCode?: string;
  updatedAt: string;
}

export interface PresetMutationState {
  requestId: string;
  name?: string | null;
  kind: PresetOperationKind;
  status: MutationStatus;
  message?: string;
  updatedAt: string;
}

export interface UserProfileData {
  name: string;
  avatarDataUrl: string | null;
  updatedAt: string;
}

export interface ModelUsageMetadata {
  source: "provider_reported" | "mixed" | "local_estimate" | "unavailable";
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  estimatedFields?: Array<
    "inputTokens" | "outputTokens" | "totalTokens" | "cacheReadTokens" | "cacheWriteTokens" | "reasoningTokens"
  >;
  calls?: Array<{
    stage: string;
    usage: Omit<ModelUsageMetadata, "calls">;
  }>;
}

export interface ConversationEntryMetadata {
  run?: {
    modelProvider: ModelProviderMetadata;
    usage?: ModelUsageMetadata;
  };
}

export interface UploadAttachmentData {
  uploadUri: string;
  name: string;
  mime: string;
  size: number;
  sha256?: string;
  status: "uploaded";
}

export interface SessionTruncatedData {
  sessionId: string;
  fromRequestId: string;
  removedEntries: number;
  replacementRequestId?: string;
}

export interface RunStartedData {
  input: string;
}

export type RunActivity =
  | "preparing_context"
  | "initializing_runtime"
  | "synchronizing_context"
  | "evaluating_context"
  | "running_agent_turn"
  | "generating_response"
  | "finalizing_response";

export type RunActivityState = "started" | "completed" | "failed";

export interface RunActivityChangedData {
  activityId: string;
  activity: RunActivity;
  state: RunActivityState;
}

export interface PromptSummaryData {
  chars: number;
  lines: number;
  tokenCount: number;
}

export interface ModelDeltaData {
  text: string;
}

export interface ModelStartedData {
  model: string;
  provider?: ModelProviderMetadata;
}

export interface ModelCompletedData {
  text: string;
  provider?: ModelProviderMetadata;
  usage?: ModelUsageMetadata;
}

export interface ToolCallsPlannedData {
  toolCount: number;
  tools: string[];
  status?: "planned" | "discovery_escalated" | "blocked";
  executionMode?: "parallel" | "sequential";
  batchId?: string;
  reason?: string;
  issues?: string[];
}

export interface ToolCallStartedData {
  index: number;
  toolName: string;
  callId: string;
  batchId?: string;
}

export interface ToolCallOutputData {
  toolName: string;
  callId: string;
  stream: "stdout" | "stderr";
  outputSequence: number;
  text: string;
  byteLength: number;
  totalBytes: number;
  batchId?: string;
  resourceId?: string;
}

export interface ToolCallProgressData {
  toolName: string;
  callId: string;
  progressSequence: number;
  message?: string;
  completed?: number;
  total?: number;
  unit?: string;
  taskId?: string;
  state?: string;
  terminal?: boolean;
  pollIntervalMs?: number;
  batchId?: string;
  resourceId?: string;
}

export interface ToolCallCompletedData {
  index: number;
  toolName: string;
  callId: string;
  batchId?: string;
  presentation?: ToolResultPresentation;
}

export interface ToolCallFailedData {
  index: number;
  toolName: string;
  callId: string;
  batchId?: string;
  code?: string;
  message: string;
  localizedMessage?: BackendLocalizedMessage;
}

export interface ToolCallResultDetailData {
  detailId: string;
  index: number;
  toolName: string;
  callId: string;
  batchId?: string;
  value: unknown;
}

export interface AssistantMessageCreatedData {
  messageId: string;
  kind: "tool_preface" | "final_answer" | "ask_user";
  content: string;
  terminal: boolean;
  toolCount?: number;
  batchId?: string;
  toolCallIds?: string[];
  reasonCode?: string;
}

export type {
  ApprovalDecision,
  ApprovalRequestedData,
  ApprovalResolvedData,
  ApprovalSubjectData,
} from "./approvalEventTypes";

export type {
  ExecutionResourceCreatedData,
  ExecutionResourceOutputData,
  ExecutionResourceRemovedData,
  ExecutionResourceResizedData,
  ExecutionResourceSnapshotData,
  ExecutionResourceSnapshotEventData,
  ExecutionResourceState,
  ExecutionResourceStateData,
  ExecutionResourceTerminalData,
} from "./executionResourceEventTypes";

export interface RunFailedData {
  message: string;
  localizedMessage?: BackendLocalizedMessage;
  code?: string;
  details?: unknown;
}

// --- 客户端 → 服务端 请求 ---

export type { WsRequest } from "./wsRequestTypes";
