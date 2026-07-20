// 协议类型。事件枚举从后端 AgentEventCatalog 生成，其他 DTO 保持前端消费视角。
import { EventKinds, EventLayers, EventPhases } from "./generatedEventCatalog";
import type { EventKind, EventLayer, EventPhase } from "./generatedEventCatalog";
import type { ProviderModelConfigOperationKind } from "./providerModelCommandTypes";

export type {
  ConfigRevisionGuardRequestInput,
  ProviderModelBulkImportGroupAssignmentInput,
  ProviderModelConfigInput,
  ProviderModelConfigOperationKind,
  ProviderModelConfigRequest,
  ProviderModelEndpointInput,
  ProviderModelEndpointKind,
  ProviderModelGroupAssignmentInput,
} from "./providerModelCommandTypes";

export type {
  ActionPlannerStageCompletedData,
  ActionPlannerStageFailedData,
  ActionPlannerStageName,
  ActionPlannerStageStartedData,
  TurnContextMode,
  TurnUnderstandingData,
} from "./plannerEventTypes";

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

export { EventKinds, EventLayers, EventPhases };
export type { EventKind, EventLayer, EventPhase } from "./generatedEventCatalog";

export interface EventEnvelope<TKind extends string = EventKind, TData = unknown> {
  channel: "agent.event";
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
  operation: "session.message" | "session.close" | "session.history" | "session.fork";
  message: string;
}

export interface SessionForkedData {
  sessionId: string;
  sourceSessionId: string;
  throughRequestId: string;
  title: string;
  createdAt: string;
}

export interface SessionBusyData {
  sessionId: string;
  activeRequestId: string;
  rejectedRequestId?: string;
  operation: "session.message" | "session.close";
  message: string;
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

export interface ToolResultPresentation {
  type: "senera.tool_result_presentation.v1";
  version: 1;
  status: "success" | "failure" | "empty";
  headline: string;
  summary?: string;
  facts: ToolResultPresentationFact[];
  evidence: ToolResultPresentationEvidence[];
  changes: ToolResultPresentationChange[];
  artifactUri?: string;
}

export interface ToolResultPresentationFact {
  name: string;
  value: string;
  kind?: string;
  evidenceUri?: string;
  confidence?: number;
}

export interface ToolResultPresentationEvidence {
  evidenceUri: string;
  kind: string;
  display: string;
  label: string;
  source: string;
  locator: string;
  confidence: number;
}

export interface ToolResultPresentationChange {
  kind: string;
  status: "added" | "changed" | "unchanged";
  key: string;
  summary: string;
}

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
  details?: unknown;
}

export type SandboxEffectiveMode = "sandbox" | "fallback";
export type SandboxRuntimeState = "unknown" | "preparing" | "ready" | "fallback";

export interface SandboxDiagnosticData {
  code: string;
  severity: "warning" | "error";
  message: string;
  recommendation: string;
  details: string[];
  manualCommands?: string[];
}

export interface SandboxDependencySnapshotData {
  errors: string[];
  warnings: string[];
}

export interface SandboxStatusSnapshotData {
  provider: string;
  platform: string;
  state: SandboxRuntimeState;
  supported: boolean;
  effectiveMode: SandboxEffectiveMode;
  dependencies: SandboxDependencySnapshotData;
  diagnostics: SandboxDiagnosticData[];
  message: string;
  updatedAt: string;
}

export interface PluginConfigSection {
  name: string;
  label: string;
  description?: string;
  keyCount: number;
  toml: string;
  fields: PluginConfigField[];
}

export type PluginConfigFieldType = "boolean" | "string" | "number" | "array" | "table";

export type PluginConfigFieldOptionValue = string | number | boolean;

export interface PluginConfigField {
  label: string;
  section: string;
  key: string;
  path: string[];
  type: PluginConfigFieldType;
  itemType?: PluginConfigFieldType;
  value: unknown;
  description?: string;
  placeholder?: string;
  options?: PluginConfigFieldOptionValue[];
  optionLabels?: Record<string, string>;
  min?: number;
  max?: number;
  step?: number;
  secret?: boolean;
  multiline?: boolean;
  required?: boolean;
}

export interface PluginConfigDiagnostic {
  severity: "error" | "warning";
  message: string;
}

export interface PluginConfigToolItem {
  name: string;
  summary?: string;
  enabled: boolean;
}

export interface PluginConfigItem {
  name: string;
  title: string;
  kind: string;
  rootKind: "System" | "User";
  description?: string;
  rootPath: string;
  manifestPath: string;
  configPath: string;
  configExists: boolean;
  configSource: "file" | "example" | "default";
  configTemplatePath?: string;
  configTemplateExists: boolean;
  needsUserConfig: boolean;
  enabled: boolean;
  available: boolean;
  toolCount: number;
  enabledToolCount: number;
  tools: PluginConfigToolItem[];
  sections: PluginConfigSection[];
  toml: string;
  diagnostics: PluginConfigDiagnostic[];
}

export type PluginConfigOperationKind = "list" | "update" | "set_enabled";

export interface PluginConfigOperationResult {
  requestId?: string;
  kind: PluginConfigOperationKind;
  pluginName?: string;
}

export interface PluginConfigSnapshotData {
  plugins: PluginConfigItem[];
  operation?: PluginConfigOperationResult;
}

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
  details?: unknown;
  operation?: PresetOperationResult;
}

export interface ConfigFailedData {
  configPath: string;
  message: string;
  details?: unknown;
  operation?: PluginConfigOperationResult | ConfigOperationResult;
}

export type ConfigSnapshotSource = "sqlite" | "json";

export type ConfigOperationKind = "config_update" | ProviderModelConfigOperationKind;

export interface ConfigOperationResult {
  requestId?: string;
  kind: ConfigOperationKind;
}

export interface ConfigDiagnosticData {
  severity: "warning" | "error";
  message: string;
  details?: unknown;
}

export type ConfigFormFieldType = "boolean" | "string" | "number" | "array" | "table" | "record";

export type ConfigFormFieldOptionValue = string | number | boolean;

export interface ConfigFormSnapshotData {
  version: 1;
  sections: ConfigFormSectionData[];
}

export interface ConfigFormSectionData {
  name: string;
  label: string;
  description?: string;
  icon?: string;
  keyCount: number;
  fields: ConfigFormFieldData[];
}

export interface ConfigFormFieldData {
  label: string;
  section: string;
  key: string;
  path: string[];
  type: ConfigFormFieldType;
  itemType?: ConfigFormFieldType;
  value: unknown;
  effectiveValue: unknown;
  configured: boolean;
  description?: string;
  placeholder?: string;
  options?: ConfigFormFieldOptionValue[];
  optionLabels?: Record<string, string>;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  step?: number;
  secret?: boolean;
  multiline?: boolean;
  required?: boolean;
  addLabel?: string;
  itemLabelPath?: string[];
  itemFields?: ConfigFormFieldData[];
  defaultValue?: unknown;
  defaultItem?: Record<string, unknown>;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export interface ConfigSnapshotData {
  path: string;
  version: number;
  value: Record<string, unknown>;
  source: ConfigSnapshotSource;
  revision?: number;
  databasePath?: string;
  diagnostics: ConfigDiagnosticData[];
  form: ConfigFormSnapshotData;
  operation?: ConfigOperationResult;
}

export type PluginConfigMutationStatus = "pending" | "success" | "error";

export interface PluginConfigMutationState {
  requestId: string;
  pluginName: string;
  kind: PluginConfigOperationKind;
  status: PluginConfigMutationStatus;
  message?: string;
  updatedAt: string;
}

export interface ConfigMutationState {
  requestId: string;
  kind: ConfigOperationKind;
  status: PluginConfigMutationStatus;
  message?: string;
  updatedAt: string;
}

export interface PresetMutationState {
  requestId: string;
  name?: string | null;
  kind: PresetOperationKind;
  status: PluginConfigMutationStatus;
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

export interface PromptSummaryData {
  chars: number;
  lines: number;
  tokenCount: number;
}

export interface ActionPlannedData {
  status: "planned" | "fallback";
  action?: string;
  expectedOutputMode?: "final_text" | "open";
  instruction?: string;
  askUserQuestion?: string;
  capabilityNeeds?: Array<{
    actions: string[];
    targets: string[];
    inputs: string[];
    outputs: string[];
    evidence: string[];
    effects: string[];
  }>;
  preferredTools: string[];
  toolSearchQueries: string[];
  loadedTools: string[] | "all";
  currentStep?: number;
  runState?: {
    totalToolCalls: number;
    totalEvidence: number;
    repeatedCallCount: number;
    stalled: boolean;
    timelineTurnCount: number;
  };
  selectedAction?: string;
  selectionRepaired?: boolean;
  payloadRepaired?: boolean;
  reason?: string;
}

export type InteractionRunMode = "direct_response" | "tool_agent_loop";

export interface InteractionRoutedData {
  mode: InteractionRunMode;
  objective: string;
  preferredTools: string[];
  discoveryQueries: string[];
  loadedTools: string[] | "all";
  expectedOutputMode?: "final_text" | "open";
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

export interface PiTraceData {
  source: "session" | "proxy" | "tool_bridge" | "substrate";
  eventType: string;
  summary: string;
  payload?: unknown;
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
  ExecutionFallbackStartedData,
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
  code?: string;
  details?: unknown;
}

// --- 客户端 → 服务端 请求 ---

export type { WsRequest } from "./wsRequestTypes";
