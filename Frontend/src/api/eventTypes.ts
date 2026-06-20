// 协议类型——与后端 Source/AgentSystem/AgentEvent.ts 保持同步
// 保持手写，避免引入构建期类型同步链路；后端协议变更时手动更新。

export const EventLayers = {
  Progress: "progress",
  Snapshot: "snapshot",
  Terminal: "terminal",
  Error: "error",
} as const;
export type EventLayer = (typeof EventLayers)[keyof typeof EventLayers];

export const EventPhases = {
  Request: "request",
  Session: "session",
  Prompt: "prompt",
  Model: "model",
  Decision: "decision",
  Retry: "retry",
  Tool: "tool",
  Run: "run",
  Config: "config",
} as const;
export type EventPhase = (typeof EventPhases)[keyof typeof EventPhases];

export const EventKinds = {
  SessionCreated: "session.created",
  SessionSnapshot: "session.snapshot",
  SessionClosed: "session.closed",
  SessionBusy: "session.busy",
  SessionNotFound: "session.not_found",
  SessionListSnapshot: "session.list.snapshot",
  SessionHistorySnapshot: "session.history.snapshot",
  SessionHistoryStarted: "session.history.started",
  SessionHistoryEntry: "session.history.entry",
  SessionHistoryChunk: "session.history.chunk",
  SessionHistorySteps: "session.history.steps",
  SessionRunHistoryChunk: "session.run_history.chunk",
  SessionHistoryCompleted: "session.history.completed",
  SessionTruncated: "session.truncated",
  RunStarted: "run.started",
  PromptRendered: "prompt.rendered",
  PromptSummary: "prompt.summary",
  ActionPlannerStageStarted: "action.planner.stage.started",
  ActionPlannerStageCompleted: "action.planner.stage.completed",
  ActionPlannerStageFailed: "action.planner.stage.failed",
  ActionPlanned: "action.planned",
  ModelStarted: "model.started",
  ModelStreamOpened: "model.stream.opened",
  ModelDelta: "model.delta",
  ModelCompleted: "model.completed",
  ModelStreamAborted: "model.stream.aborted",
  DecisionXmlProgress: "decision.xml.progress",
  DecisionXmlReady: "decision.xml.ready",
  DecisionXmlLimitReached: "decision.xml.limit_reached",
  DecisionXmlSummary: "decision.xml.summary",
  DecisionXmlDetail: "decision.xml.detail",
  DecisionParsed: "decision.parsed",
  DecisionParsedDetail: "decision.parsed.detail",
  RetryPlanned: "retry.planned",
  RetryDetail: "retry.detail",
  ToolCallsPlanned: "tool.calls.planned",
  ToolCallStarted: "tool.call.started",
  ToolCallCompleted: "tool.call.completed",
  ToolCallFailed: "tool.call.failed",
  ToolResults: "tool.results",
  ToolResultsDetail: "tool.results.detail",
  FinalAnswer: "final.answer",
  AskUser: "ask.user",
  RunCompleted: "run.completed",
  RunFailed: "run.failed",
  RunCancelled: "run.cancelled",
  RequestInvalid: "request.invalid",
  ConfigReloaded: "config.reloaded",
  ConfigFailed: "config.failed",
  ModelListSnapshot: "model.list.snapshot",
  PluginConfigSnapshot: "plugin.config.snapshot",
  ProfileSnapshot: "profile.snapshot",
} as const;
export type EventKind = (typeof EventKinds)[keyof typeof EventKinds];

export const DecisionXmlRoots = {
  ToolCalls: "senera_tool_calls",
} as const;

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
}

export interface SessionListSnapshotData {
  sessions: SessionListItem[];
}

export interface SessionNotFoundData {
  sessionId: string;
  operation: "session.message" | "session.close" | "session.history";
  message: string;
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

export interface SessionHistorySnapshotData {
  sessionId: string;
  totalEntries: number;
  messageCount: number;
  entries: Array<{
    entry: ConversationEntryDto;
    visible?: { kind: string; text: string };
  }>;
}

export interface SessionHistoryStartedData {
  sessionId: string;
  totalEntries: number;
  messageCount: number;
  refresh?: boolean;
}

export interface SessionHistoryEntryData {
  sessionId: string;
  entry: ConversationEntryDto;
  visible?: { kind: string; text: string };
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
  status: "done" | "failed";
  startedAt?: string;
  endedAt?: string;
  title?: string;
  toolArgs?: unknown;
  toolPreview?: string;
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
  title?: string;
  kind: string;
  endpoint: string;
  baseUrl: string;
  model: string;
}

export interface ModelProviderListItem {
  id: string;
  title: string;
  icon?: string;
  kind: string;
  endpoint: string;
  baseUrl: string;
  model: string;
  isDefault: boolean;
}

export interface ModelListSnapshotData {
  models: ModelProviderListItem[];
  defaultModelProviderId: string;
}

export interface PluginConfigSection {
  name: string;
  label?: string;
  description?: string;
  keyCount: number;
  toml: string;
  fields: PluginConfigField[];
}

export type PluginConfigFieldType =
  | "boolean"
  | "string"
  | "number"
  | "array"
  | "table"
  | "unknown";

export type PluginConfigFieldOptionValue = string | number | boolean;

export interface PluginConfigField {
  label?: string;
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

export interface ConfigFailedData {
  configPath: string;
  message: string;
  details?: unknown;
  operation?: PluginConfigOperationResult;
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

export interface UserProfileData {
  name: string;
  avatarDataUrl: string | null;
  updatedAt: string;
}

export interface ModelUsageMetadata {
  source: "local_estimate";
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
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
}

export interface RunStartedData {
  input: string;
}

export interface PromptSummaryData {
  chars: number;
  lines: number;
  tokenCount: number;
}

export interface ActionTaskFrameData {
  taskType: string;
  answerGoal: string;
  intentTags: string[];
  targetRefs: Array<{
    kind: string;
    value: string;
    status: string;
  }>;
  candidateTools: Array<{
    name: string;
    purpose: string;
    supports: string[];
  }>;
  discoveryQueries: string[];
  requiredEffects: Array<{
    id: string;
    effect: string;
    target: string;
    proof: string;
    reason: string;
  }>;
  requiredEvidence: Array<{
    id: string;
    need: string;
    minimum: number;
    reason: string;
  }>;
  userInputNeeds: Array<{
    question: string;
    reason: string;
  }>;
  nextStepPurpose: string;
  completionCriteria: string[];
  notes: string[];
}

export interface ActionEvidenceDecisionData {
  ready: boolean;
  missingNeeds: Array<{
    id: string;
    need: string;
    reason: string;
    status: "partial" | "missing" | "stalled" | "blocked";
    observed: number;
    required: number;
    missingFacts: string[];
    unsupportedClaims: string[];
    blockers: string[];
  }>;
  satisfiedNeeds: Array<{
    id: string;
    need: string;
    evidence: ActionEvidenceMatchData[];
  }>;
  requirementStates: Array<{
    id: string;
    need: string;
    status: "satisfied" | "partial" | "missing" | "stalled" | "blocked";
    reason: string;
    observed: number;
    required: number;
    evidence: ActionEvidenceMatchData[];
    missingFacts: string[];
    unsupportedClaims: string[];
    blockers: string[];
  }>;
  progress: {
    stalled: boolean;
    repeatedCalls: Array<{
      toolName: string;
      argsHash: string;
      count: number;
      lastStep: number;
    }>;
    nonEvidenceCalls: ActionEvidenceProgressCallData[];
    failedCalls: ActionEvidenceProgressCallData[];
  };
  verification?: {
    ready: boolean;
    requirements: Array<{
      requirementId: string;
      need: string;
      status: "satisfied" | "partial" | "missing" | "stalled" | "blocked";
      evidenceRefs: string[];
      artifactUris: string[];
      reason: string;
      missingFacts: string[];
      unsupportedClaims: string[];
    }>;
    summary: string;
  };
  recommendedTools: string[];
  searchQueries: string[];
}

export interface ActionEvidenceMatchData {
  ref: string;
  kind: string;
  toolName: string;
  artifactUri: string;
  locator: string;
  display: string;
  label: string;
  source?: string | null;
  confidence?: number | null;
  facts: Array<{
    name: string;
    value: string;
  }>;
  produces: string;
  satisfies: string[];
  quality: string;
  supportingSignals: string[];
}

export interface ActionEvidenceProgressCallData {
  step: number;
  toolName: string;
  status: string;
  resultKind: string;
  artifactUri: string;
  evidenceRefs: string[];
  argumentsPreview: string;
  error: string;
}

export interface ActionPlannedData {
  status: "planned" | "fallback";
  action?: string;
  expectedOutputMode?: "tool_call_xml" | "final_text" | "open";
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
  taskFrame?: ActionTaskFrameData;
  evidenceDecision?: ActionEvidenceDecisionData;
  reason?: string;
}

export type ActionPlannerStageName = "buildTaskFrame" | "evaluateEvidence";

export interface ActionPlannerStageStartedData {
  stage: ActionPlannerStageName;
}

export interface ActionPlannerStageCompletedData {
  stage: ActionPlannerStageName;
  selectedAction?: string;
  repaired?: boolean;
  taskFrame?: ActionTaskFrameData;
  evidenceDecision?: ActionEvidenceDecisionData;
}

export interface ActionPlannerStageFailedData {
  stage: ActionPlannerStageName;
  message: string;
}

export interface ModelDeltaData {
  text: string;
}

export interface ModelStartedData {
  model: string;
  provider?: ModelProviderMetadata;
}

export interface ModelStreamOpenedData {
  provider?: ModelProviderMetadata;
}

export interface ModelCompletedData {
  text: string;
  provider?: ModelProviderMetadata;
}

export interface DecisionXmlProgressData {
  state: string;
  xml: string;
  /** 后端已经把 CDATA 剥好、实体转义反过来的"用户可见文本"——流式逐步增长 */
  kind: "final_answer" | "ask_user" | "tool_calls" | "unknown";
  text: string;
  preambleText: string;
}

export interface DecisionXmlSummaryData {
  chars: number;
  lines: number;
  root?: string;
  sanitized: boolean;
  detailId: string;
}

export interface DecisionParsedData {
  root: string;
  decisionKind: string;
  detailId: string;
}

export interface DecisionParsedDetailData {
  detailId: string;
  root: string;
  decisionKind: string;
  payload: unknown;
}

export interface ToolCallsPlannedData {
  toolCount: number;
  tools: string[];
}

export interface ToolCallStartedData {
  index: number;
  toolName: string;
  callId: string;
}

export interface ToolCallCompletedData {
  index: number;
  toolName: string;
  callId: string;
  preview?: string;
}

export interface ToolCallFailedData {
  index: number;
  toolName: string;
  callId: string;
  code?: string;
  message: string;
}

export interface ToolResultsDetailData {
  detailId: string;
  xml: string;
  value: unknown;
}

export interface FinalAnswerData {
  content: string;
}

export interface AskUserData {
  question: string;
  reasonCode?: string;
}

export interface RetryPlannedData {
  attempt: number;
  code: string;
  message: string;
  retryable: boolean;
  detailId: string;
}

export interface RunFailedData {
  message: string;
  code?: string;
  details?: unknown;
}

// --- 客户端 → 服务端 请求 ---

export type WsRequest =
  | { type: "session.create"; sessionId?: string }
  | {
      type: "session.message";
      sessionId: string;
      requestId?: string;
      modelProviderId?: string;
      input: string;
      attachments?: UploadAttachmentData[];
    }
  | { type: "session.close"; sessionId: string }
  | { type: "session.cancel"; sessionId: string }
  | { type: "session.truncate_from"; sessionId: string; requestId: string }
  | { type: "session.list" }
  | { type: "session.history"; sessionId: string; refresh?: boolean }
  | { type: "session.rename"; sessionId: string; title: string }
  | { type: "model.list" }
  | { type: "plugin.config.list" }
  | { type: "plugin.config.update"; requestId?: string; pluginName: string; toml: string }
  | { type: "plugin.config.set_enabled"; requestId?: string; pluginName: string; toolName?: string; enabled: boolean }
  | { type: "profile.get" }
  | { type: "profile.update"; profile: Pick<UserProfileData, "name" | "avatarDataUrl"> };
