import type { ApprovalBatchReference } from "../../api/approvalEventTypes";
import type {
  ApprovalDecision,
  ApprovalRequestedData,
  ApprovalResolvedData,
  ApprovalSubjectData,
  ChannelStatusItem,
  ConfigSnapshotData,
  ContinuityRecallQueryData,
  ContinuitySnapshotData,
  ConversationEntryDto,
  ConversationEntryMetadata,
  EventEnvelope,
  AgendaSnapshotData,
  WorldSnapshotData,
  ExecutionSnapshotData,
  InteractionInputAction,
  InteractionInputContent,
  InteractionInputRequestedData,
  InteractionInputResolvedData,
  InteractionInputSchema,
  McpServerSettingsItem,
  ModelProviderListItem,
  ModelProviderMetadata,
  PresetItem,
  PresetWorldPackageDescriptor,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
  RunCancellationProgressData,
  SessionHistoryStepsData,
  SessionChannelMetadata,
  SystemExtensionSettingsItem,
  SystemToolSettingsItem,
  TodoSnapshotData,
  UploadAttachmentData,
  UserProfileData,
} from "../../api/eventTypes";
import type { ExecutionApprovalMode } from "../../api/executionApprovalMode";
import type { MotionLevel } from "../../shared/motion/types";
import type { UserProfile } from "./userProfile";

export { DEFAULT_SESSION_TITLE } from "./defaults";
export { DEFAULT_USER_PROFILE } from "./userProfile";
export type { UserProfile };

export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  kind?: "AssistantFinal" | "AssistantAsk" | "AssistantToolPreface" | "Error";
  /** 后端 conversation entry 的 requestId——用于 truncate_from（删除 / 重新回答） */
  requestId?: string;
  attachments?: UploadAttachmentData[];
  metadata?: ConversationEntryMetadata;
}

export type TimelineStepKind =
  | "understand"
  | "prompt"
  | "model"
  | "decision"
  | "delegation"
  | "tool"
  | "retry"
  | "answer"
  | "error"
  | "training"
  | "recall"
  | "harness";

export type TimelineStepStatus = "pending" | "running" | "cancelling" | "done" | "failed";

export interface TimelineStepScope {
  parentSessionId?: string;
  parentRequestId?: string;
  workflowName?: string;
  jobId?: string;
  childRunId?: string;
  agentName?: string;
  role?: "childAgent" | "merge";
}

export interface TimelineToolBatch {
  id: string;
  index?: number;
  size?: number;
  executionMode?: "parallel" | "sequential";
}

export interface TimelineToolOutput {
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  lastSequence: number;
  truncated: boolean;
}

export interface TimelineToolProgress {
  sequence: number;
  message?: string;
  completed?: number;
  total?: number;
  unit?: string;
  taskId?: string;
  state?: string;
  terminal?: boolean;
  pollIntervalMs?: number;
}

export interface TimelineStep {
  id: string;
  kind: TimelineStepKind;
  title: string;
  description?: string;
  status: TimelineStepStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  scope?: TimelineStepScope;
  toolName?: string;
  toolOrigin?: import("../../api/eventTypes").ToolEventOrigin;
  callId?: string;
  toolBatch?: TimelineToolBatch;
  purpose?: string;
  toolArgs?: unknown;
  toolPreview?: string;
  toolPresentation?: import("../../api/eventTypes").ToolResultPresentation;
  toolResult?: unknown;
  toolErrorMessage?: string;
  toolOutput?: TimelineToolOutput;
  toolProgress?: TimelineToolProgress;
  detailJson?: unknown;
  retryAttempt?: number;
  retryCode?: string;
  errorMessage?: string;
  modelName?: string;
  promptChars?: number;
  promptLines?: number;
  promptTokenCount?: number;
  decisionKind?: string;
  xmlRoot?: string;
  childRun?: TimelineChildRunState;
}

export interface TimelineChildRunMessage {
  id: string;
  direction: "child_to_parent" | "parent_to_child";
  kind: "decision" | "follow_up" | "progress" | "response" | "steering";
  content: string;
  createdAt: string;
}

export type TimelineChildRunTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TimelineChildRunTodoItem {
  content: string;
  status: TimelineChildRunTodoStatus;
}

export interface TimelineChildRunTodo {
  planObserved: boolean;
  counts: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    cancelled: number;
  };
  items?: TimelineChildRunTodoItem[];
}

export interface TimelineChildRunState {
  id: string;
  status:
    | "queued"
    | "running"
    | "wrapping_up"
    | "cancelling"
    | "awaiting_supervisor"
    | "completed"
    | "partial_completed"
    | "interrupted"
    | "timed_out"
    | "failed"
    | "cancelled";
  checkpointAvailable?: boolean;
  lastActivityAt?: string;
  lastModelOutputAt?: string;
  modelOutputCharacters?: number;
  assistantTurns?: number;
  toolCalls?: {
    planned: number;
    started: number;
    completed: number;
    failed: number;
  };
  activeTools?: string[];
  artifactCount?: number;
  softDeadlineAt?: string;
  hardDeadlineAt?: string;
  grantedExtensionMs?: number;
  cancellation?: RunCancellationProgressData & { updatedAt: string };
  messages: TimelineChildRunMessage[];
  todo?: TimelineChildRunTodo;
}

export interface RunActivityRecord {
  id: string;
  parentId?: string;
  activity: import("../../api/eventTypes").RunActivity;
  status: TimelineStepStatus;
  step?: number;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
}

export interface RunRecord {
  requestId: string;
  /** 单调递增的运行态版本；UI 用它感知 run 变化，不依赖具体字段 */
  revision: number;
  startedAt: string;
  endedAt?: string;
  status: "running" | "cancelling" | "completed" | "failed" | "cancelled";
  /** Assistant output lifecycle is independent from Pi/session settlement. */
  outputState: "pending" | "streaming" | "available" | "committed";
  /** 左侧对话使用的瞬时运行阶段；不进入工作流步骤或历史图。 */
  liveActivity?: import("../../api/eventTypes").RunActivity;
  /** 左侧对话使用的实时活动流；与右侧工作流步骤完全独立。 */
  activities?: RunActivityRecord[];
  activeFlags?: Array<"waiting_for_approval" | "waiting_for_input">;
  input: string;
  steps: TimelineStep[];
  /** model.delta 累积（原始 token 流，可能含 XML 包装） */
  streamingRaw: string;
  /** 旧版 XML 预览字段；新链路仅用于历史兼容显示 */
  xmlPreview: string;
  /** 后端实时解析出的用户可见文本目标 */
  visibleText: string;
  /** 前端平滑消费 visibleText 后真正展示的文本，不影响 streamingRaw 准确性 */
  displayText: string;
  /** 当前 visibleText 对应的助手消息；切换模型阶段时清除 */
  displayMessageId?: string;
  visibleKind: "final_answer" | "ask_user" | "tool_calls" | "tool_preface" | "unknown";
  expectedOutputMode: "unknown" | "final_text" | "open";
  decisionMode: "none" | "tool_candidate" | "final_text";
  /** Planner decision to apply to the next model stream, before that stream starts. */
  plannedDecisionMode?: "tool_candidate" | "final_text";
  approvals?: ApprovalRunRecord[];
  interactionInputs?: InteractionInputRunRecord[];
  modelProvider?: ModelProviderMetadata;
  /** Context that was actually injected before this run started. */
  continuity?: ContinuitySnapshotData;
  /** Three-tier prompt harness composition report for this run. */
  harness?: import("../../api/eventTypes").PromptHarnessComposedData;
  /** Recall observability for this run: local plan, match counts, and latency. */
  recall?: {
    original?: string;
    degraded?: string;
    local?: ContinuityRecallQueryData["local"];
    injectedCount?: number;
    matchedByCounts?: {
      textSimilarity: number;
      lexical: number;
      exactPhrase: number;
      exactReference: number;
      embedding: number;
    };
    semanticStatus?: string;
    semanticIndexedCount?: number;
    semanticCompatibleCount?: number;
    latencyMs?: number;
  };
  execution?: ExecutionSnapshotData;
  todos?: TodoSnapshotData;
  recoverySource?: "history";
}

interface InteractionInputRunRecordBase {
  interactionId: string;
  status: InteractionInputRequestedData["status"] | InteractionInputResolvedData["status"];
  message: string;
  toolName: string;
  toolCallId: string;
  batchId?: string;
  createdAt: string;
  action?: InteractionInputAction;
  content?: InteractionInputContent;
  resolutionMessage?: string;
  resolvedAt?: string;
  resolutionPending?: boolean;
  pendingAction?: InteractionInputAction;
}

export type InteractionInputRunRecord = InteractionInputRunRecordBase &
  (
    | { mode: "form"; schema: InteractionInputSchema }
    | { mode: "url"; externalId: string; url: string; hostname: string }
  );

export interface ApprovalRunRecord {
  approvalId: string;
  approvalKind: ApprovalRequestedData["approvalKind"];
  status: ApprovalRequestedData["status"] | ApprovalResolvedData["status"];
  title: string;
  reason: string;
  rule?: string;
  riskSignals?: string[];
  toolCallId?: string;
  batchId?: string;
  availableDecisions: ApprovalDecision[];
  subject: ApprovalSubjectData;
  createdAt: string;
  resolvedAt?: string;
  message?: string;
  scope?: ApprovalResolvedData["scope"];
  disposition?: ApprovalResolvedData["disposition"];
  decision?: ApprovalResolvedData["decision"];
  resolutionPending?: boolean;
  pendingDecision?: ApprovalDecision;
}

export interface SessionRecord {
  sessionId: string;
  title: string;
  status: "creating" | "ready" | "closed";
  createdAt: string;
  updatedAt: string;
  entryCount: number;
  messageCount: number;
  messages: ChatMessage[];
  runs: RunRecord[];
  activeRequestId?: string;
  channel?: SessionChannelMetadata;
  forkOrigin?: {
    sourceSessionId: string;
    throughRequestId: string;
  };
}

export type HistoryReplayEntry = {
  entry: ConversationEntryDto;
  visible?: { kind: string; text: string };
};

export type SessionOrderPlacement = "before" | "after";

export interface StoreState {
  sessions: Record<string, SessionRecord>;
  sessionOrder: string[];
  activeSessionId: string | null;
  agenda?: AgendaSnapshotData;
  world?: WorldSnapshotData;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  defaultSidebarCollapsed: boolean;
  defaultRightPanelCollapsed: boolean;
  workflowDockWidth: number;
  motionLevel: MotionLevel;
  /** 每个 session 当前在右栏查看的 run requestId；不存在则用最新 run */
  viewedRunIdBySession: Record<string, string>;
  /** 已从后端拉取过历史的 sessionId 集合（避免重复拉） */
  historyLoadedIds: Record<string, boolean>;
  /** 正在拉取历史的 sessionId */
  historyLoadingIds: Record<string, boolean>;
  /** 历史回放失败的 sessionId，避免把失败会话伪装成新会话空态 */
  historyFailedIds: Record<string, boolean>;
  /** 正在回放但尚未 completed 的历史条目；completed 前不污染真实消息列表 */
  historyReplayBuffers: Record<string, HistoryReplayEntry[]>;
  /** 回放期间暂存的 step 轨迹 run，completed 时据此重建 session.runs */
  historyStepBuffers: Record<string, SessionHistoryStepsData["runs"]>;
  /** 回放期间已经由 run events 还原过的 requestId，避免再用精简 step traces 覆盖完整图 */
  historyEventRunIds: Record<string, Record<string, boolean>>;
  /** 历史事件可能改写 activeRequestId；这里保留服务端实时快照用于回放收尾。 */
  historyActiveRequestIds: Record<string, string | null>;
  /** 当前前端生命周期内已经投影的服务端事件，用于 live/replay 全局幂等。 */
  processedEventIds: Record<string, string | null>;
  processedEventIdOrder: string[];
  /** 已确认不在后端存在、仅本地残留的 sessionId */
  missingOnServerIds: Record<string, boolean>;
  /** 本地刚创建、尚未被 session.list 快照确认的 sessionId */
  pendingCreatedSessionIds: Record<string, boolean>;
  /** 本地已请求删除、尚未被 session.list 快照确认消失的 sessionId */
  pendingDeletedSessionIds: Record<string, boolean>;
  /** 子代理事件声明的 childSessionId -> owning parent sessionId 关系。子会话不进入顶层聊天列表。 */
  childSessionParentIds: Record<string, string>;
  modelProviders: ModelProviderListItem[];
  providerModelCatalogs: Record<string, ProviderModelsSnapshotData>;
  providerModelErrors: Record<string, ProviderModelsFailedData & { updatedAt: string }>;
  /** Current active conversation's model. Kept for existing command/UI contracts. */
  selectedModelProviderId: string | null;
  /** Authoritative default model from model.list; used when creating a new conversation. */
  defaultModelProviderId: string | null;
  /** Local per-conversation selections. The backend still receives the chosen id per request. */
  selectedModelProviderIdsBySession: Record<string, string>;
  executionApprovalMode: ExecutionApprovalMode;
  presets: PresetItem[];
  presetWorldPackages: PresetWorldPackageDescriptor[];
  activePresetName: string | null;
  presetsEnabled: boolean;
  presetRootDir: string;
  configSnapshot: ConfigSnapshotData | null;
  systemTools: SystemToolSettingsItem[];
  systemExtensions: SystemExtensionSettingsItem[];
  mcpServers: McpServerSettingsItem[];
  toolSettingsSynced: { systemTools: boolean; mcpServers: boolean };
  channelStatuses: ChannelStatusItem[];
  userProfile: UserProfile;
  /** 各目录快照是否已到达过一次；用于区分"尚未同步"与"确实为空"，避免空态闪现 */
  catalogSynced: { sessions: boolean; presets: boolean };
  /** 连接切换时清除目录同步屏障，直到新的权威快照到达。 */
  resetCatalogSyncState: () => void;
  /** 丢弃断线前的历史新鲜度标记，等待重连后的权威回放。 */
  invalidateSessionHistoryCache: () => void;

  selectSession: (id: string) => void;
  moveSession: (sessionId: string, targetSessionId: string, placement: SessionOrderPlacement) => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  setDefaultSidebarCollapsed: (collapsed: boolean) => void;
  setDefaultRightPanelCollapsed: (collapsed: boolean) => void;
  setWorkflowDockWidth: (width: number) => void;
  setMotionLevel: (level: MotionLevel) => void;
  markRunCancelling: (sessionId: string, requestId: string) => void;
  setViewedRun: (sessionId: string, requestId: string | undefined) => void;
  registerCreatingSession: (sessionId: string, title?: string, modelProviderId?: string | null) => void;
  renameSession: (sessionId: string, title: string) => void;
  markApprovalResolutionPending: (approvalId: string, decision?: ApprovalDecision) => void;
  markApprovalBatchResolutionPending: (batch: ApprovalBatchReference, decision?: ApprovalDecision) => void;
  markInteractionInputResolutionPending: (interactionId: string, action?: InteractionInputAction) => void;
  appendUserMessage: (
    sessionId: string,
    requestId: string,
    input: string,
    attachments?: UploadAttachmentData[],
    options?: { createRun?: boolean },
  ) => void;
  truncateFromRequest: (sessionId: string, fromRequestId: string) => void;
  advanceStreamingDisplay: (sessionId: string, requestId: string) => boolean;
  ingest: (env: EventEnvelope) => void;
  ingestMany: (events: readonly EventEnvelope[]) => void;
  removeSession: (sessionId: string) => void;
  clearAllSessions: (sessionIds?: string[]) => void;
  markHistoryLoading: (sessionId: string) => void;
  markHistoryLoadFailed: (sessionId: string) => void;
  selectModelProvider: (id: string) => void;
  applyDefaultModelToActiveSession: () => void;
  setExecutionApprovalMode: (mode: ExecutionApprovalMode) => void;
  setUserProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
  markUserProfileSynced: (profile?: UserProfileData) => void;
  replaceWithDevMockData: (sessions: SessionRecord[], activeSessionId?: string) => void;
}
