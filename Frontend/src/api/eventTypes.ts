// 协议类型。事件枚举从后端 AgentEventCatalog 生成，其他 DTO 保持前端消费视角。
import { EventChannels, EventKinds, EventLayers, EventPhases } from "./generatedEventCatalog";
import type {
  EventChannel,
  EventKind,
  EventLayer,
  EventPhase,
  RunActivity,
  RunActivityState,
} from "./generatedEventCatalog";
import type { ProviderModelConfigOperationKind } from "./providerModelCommandTypes";
import type { BackendLocalizedMessage } from "../i18n/backendMessage";
import type { ModelThinkingLevel, ModelThinkingProfile } from "./modelThinkingTypes";
import type { ConfigFormSnapshotData } from "./configFormEventTypes";

export type { ModelThinkingLevel, ModelThinkingProfile, ModelThinkingProfileConfig } from "./modelThinkingTypes";
export type {
  ConfigFormFieldData,
  ConfigFormFieldOptionValue,
  ConfigFormFieldType,
  ConfigFormModelCapability,
  ConfigFormModelSelectionData,
  ConfigFormSectionData,
  ConfigFormSnapshotData,
  ConfigFormValueSource,
} from "./configFormEventTypes";
export type {
  SystemExtensionConfigurationSettings,
  SystemExtensionSettingsItem,
  SystemExtensionToolSettingsItem,
  SystemToolSettingsItem,
  SystemToolSnapshotData,
} from "./systemExtensionEventTypes";
export type {
  WorkspaceSnapshotData,
  WorkspaceSwitchFailedData,
  WorkspaceSwitchStartedData,
} from "./workspaceEventTypes";

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

export type {
  ContinuityRulesSnapshotData,
  ContinuitySelectionCountData,
  ContinuitySnapshotData,
  PromptHarnessComposedData,
  ContinuityRecallQueryData,
  ContinuityRecallSettledData,
  ContinuityRecallLocalMatchData,
  ContinuityRecallLocalPlanData,
  ContinuityRecallLocalRelationData,
  AgendaActorData,
  AgendaClockData,
  AgendaRecordData,
  AgendaSnapshotData,
  AgendaSnapshotEventData,
  AgendaTimelineEntryData,
  AgendaWorldData,
  WorldSnapshotData,
  WorldSnapshotEventData,
  ExecutionData,
  ExecutionEventData,
  ExecutionSnapshotData,
  ExecutionStepData,
  TodoCountsData,
  TodoData,
  TodoSnapshotData,
} from "./goalContinuityEventTypes";

export type {
  AssistantMessageCreatedData,
  ToolCallCompletedData,
  ToolCallFailedData,
  ToolCallOutputData,
  ToolCallProgressData,
  ToolCallResultDetailData,
  ToolCallStartedData,
  ToolCallsPlannedData,
  ToolEventOrigin,
  ToolResultPresentation,
  ToolResultPresentationChange,
  ToolResultPresentationEvidence,
  ToolResultPresentationFact,
} from "./toolEventTypes";

import type { ToolEventOrigin, ToolResultPresentation } from "./toolEventTypes";

export type {
  ChildRunCancellingData,
  ChildRunDeadlineExtendedData,
  ChildRunEventIdentityData,
  ChildRunLifecycleData,
  ChildRunMessageCreatedData,
  ChildRunMessageDirection,
  ChildRunMessageKind,
  ChildRunSnapshotData,
  ChildRunStatus,
  ChildRunWrappingUpData,
} from "./childRunEventTypes";

export type {
  McpInputMutationState,
  McpInputStatus,
  McpInputValue,
  McpServerSettingsItem,
  McpServerSnapshotData,
} from "./mcpSettingsEventTypes";

export { EventChannels, EventKinds, EventLayers, EventPhases };
export type {
  EventChannel,
  EventKind,
  EventLayer,
  EventPhase,
  RunActivity,
  RunActivityCategory,
  RunActivityState,
} from "./generatedEventCatalog";

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

export type EventSourceChannel = "console" | "qq" | "telegram" | "discord";

export interface EventScope {
  channel?: EventSourceChannel;
  parentSessionId?: string;
  parentRequestId?: string;
  workflowName?: string;
  jobId?: string;
  childRunId?: string;
  agentName?: string;
  role?: "childAgent" | "merge";
}

export interface SessionChannelMetadata {
  platform: Exclude<EventSourceChannel, "console">;
  chatType?: "direct" | "group" | "channel" | "thread";
  chatId?: string;
  userId?: string;
  messageId?: string;
}

export type ChannelStatusItem = {
  kind: "telegram" | "qq" | "discord";
  enabled: boolean;
  connected: boolean;
  state: "stopped" | "connecting" | "connected" | "reconnecting" | "degraded";
  mode?: string;
  error?: string;
};

export interface ChannelStatusSnapshotData {
  statuses: ChannelStatusItem[];
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
  channel?: SessionChannelMetadata;
  modelProviderId?: string;
  effectiveModel?: {
    sessionId: string;
    requestId: string;
    providerId: string;
    model: string;
    endpoint: string;
    baseUrl: string;
    source: "request" | "session_preference" | "default" | "channel";
    effectiveAt: string;
    logicalCacheScope?: string;
    physicalPiSessionId?: string;
  };
  modelPreference?: {
    modelProviderId: string;
    revision: number;
    updatedAt: string;
    source: "user" | "agent" | "channel";
  };
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
  channel?: SessionChannelMetadata;
  modelProviderId?: string;
  effectiveModel?: SessionSnapshotData["effectiveModel"];
  modelPreference?: SessionSnapshotData["modelPreference"];
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
    compactionCandidate?: SessionCompactionCandidateStatus;
  };
}

export interface SessionContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface SessionCompactionCandidateStatus {
  phase: "idle" | "preparing" | "ready" | "applying" | "failed";
  updatedAt: string;
  failurePhase?: "preparation" | "application";
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
  /** 最近窗口的轻量首屏预览；完整回放仍会随后发送。 */
  preview?: boolean;
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
  toolOrigin?: ToolEventOrigin;
  callId?: string;
  batchId?: string;
  purpose?: string;
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
  providerId?: string;
  icon?: string;
  capabilities: ModelCapabilitiesData;
  kind: string;
  endpoint: string;
  baseUrl: string;
  model: string;
  isDefault: boolean;
  modelsDev?: ModelsDevModelMetadata;
  thinkingLevels?: ModelThinkingLevel[];
  thinkingProfiles?: ModelThinkingProfile[];
  defaultThinkingLevel?: ModelThinkingLevel;
}

export type ModelToolPlanningMode = "native" | "baml";

export interface ModelCapabilitiesData {
  Chat?: boolean;
  Vision?: boolean;
  ImageOutput?: boolean;
  Reasoning?: boolean;
  ToolCalling?: boolean;
  DeveloperRole?: boolean;
  StreamingUsage?: boolean;
}

export interface ModelListSnapshotData {
  models: ModelProviderListItem[];
  modelsDev?: ModelsDevCatalogStatus;
  defaultModelProviderId: string;
}

export interface ProviderModelInfo {
  id: string;
  ownedBy?: string;
  modelsDev?: ModelsDevModelMetadata;
}

export interface ModelsDevPricing {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelsDevLink {
  label: string;
  url: string;
  type?: string;
}

export interface ModelsDevModelMetadata {
  id: string;
  sourceModelId: string;
  providerId?: string;
  name?: string;
  description?: string;
  family?: string;
  knowledge?: string;
  releaseDate?: string;
  lastUpdated?: string;
  attachment?: boolean;
  reasoning?: boolean;
  toolCall?: boolean;
  structuredOutput?: boolean;
  temperature?: boolean;
  contextLimit?: number;
  inputLimit?: number;
  outputLimit?: number;
  inputModalities: string[];
  outputModalities: string[];
  openWeights?: boolean;
  license?: string;
  pricing?: ModelsDevPricing;
  links?: ModelsDevLink[];
}

export interface ModelsDevCatalogStatus {
  source: "models.dev";
  state: "ready" | "stale" | "unavailable";
  sourceKind: "cache" | "network";
  fetchedAt?: string;
  checkedAt?: string;
  modelCount: number;
  providerCount: number;
  error?: string;
}

export interface ProviderModelsSnapshotData {
  providerId: string;
  baseUrl: string;
  fetchedAt: string;
  source: "cache" | "network";
  modelsDev?: ModelsDevCatalogStatus;
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

export interface PresetDiagnostic {
  severity: "error" | "warning";
  message: string;
}

export interface PersonaPresetExample {
  id: string;
  situation: string;
  reply: string;
}

export interface PersonaPresetLoreEntry {
  id: string;
  title: string;
  keywords: string[];
  content: string;
  enabled: boolean;
}

export interface PersonaPresetCard {
  schemaVersion: "senera.persona/v2";
  title: string;
  corePersona: string;
  languageStyle: string;
  worldPackageIds: string[];
  examples: PersonaPresetExample[];
  lore: PersonaPresetLoreEntry[];
}

export interface PresetWorldPackageDescriptor {
  id: string;
  title: string;
  entityCount: number;
  relationCount: number;
  stateMachineCount: number;
  habitCount: number;
  autonomyCount: number;
}

export interface PresetItem {
  name: string;
  title: string;
  sizeBytes: number;
  updatedAt: string;
  active: boolean;
  card?: PersonaPresetCard;
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
  worldPackages: PresetWorldPackageDescriptor[];
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
  channel?: SessionChannelMetadata;
  run?: {
    modelProvider: ModelProviderMetadata;
    usage?: ModelUsageMetadata;
  };
  scheduledTask?: {
    taskId: string;
    runId: string;
  };
  backgroundTask?: {
    taskId: string;
    runId: string;
  };
  queue?: {
    parentRequestId: string;
    mode: "steer" | "follow_up";
  };
}

export interface UploadAttachmentData {
  resourceUri: string;
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
  approvalMode?: import("./executionApprovalMode").ExecutionApprovalMode;
  attachments?: UploadAttachmentData[];
  internal?: boolean;
  displayInput?: string;
}

export interface RunActivityChangedData {
  activityId: string;
  parentActivityId?: string;
  activity: RunActivity;
  state: RunActivityState;
  startedAt: string;
  durationMs?: number;
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
export { ExecutionApprovalModes, isExecutionApprovalMode } from "./executionApprovalMode";
export type { ExecutionApprovalMode } from "./executionApprovalMode";
