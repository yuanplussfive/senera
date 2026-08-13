import { create } from "zustand";
import { persist } from "zustand/middleware";
import { clampWorkflowDockWidth, DEFAULT_WORKFLOW_DOCK_WIDTH } from "../shared/responsive/workflowDock";
import { immer } from "zustand/middleware/immer";
import { DEFAULT_SESSION_TITLE } from "./session/defaults";
import { clearPersistedStore, sessionPersistOptions } from "./session/persistence";
import { installSessionPreferenceSynchronization } from "./session/sessionPreferenceSync";
import {
  advanceRunDisplayText,
  applyEvent,
  bumpSessionMessageCount,
  createRunRecord,
  truncateSessionFromRequest,
  truncate,
  markSessionDeletionRequested,
} from "./session/sessionProjector";
import {
  applyDefaultModelToActiveSession,
  selectModelForActiveSession,
  syncActiveSessionModelSelection,
} from "./session/sessionModelSelection";
import { DEFAULT_USER_PROFILE, normalizeUserProfile, type UserProfile } from "./session/userProfile";
import type { MotionLevel } from "../shared/motion/types";
import type { ApprovalBatchReference } from "../api/approvalEventTypes";
import { ExecutionApprovalModes, type ExecutionApprovalMode } from "../api/executionApprovalMode";
import {
  type ConversationEntryDto,
  type ConversationEntryMetadata,
  type ConfigSnapshotData,
  type EventEnvelope,
  type ApprovalDecision,
  type ApprovalRequestedData,
  type ApprovalResolvedData,
  type ApprovalSubjectData,
  type InteractionInputAction,
  type InteractionInputContent,
  type InteractionInputRequestedData,
  type InteractionInputResolvedData,
  type InteractionInputSchema,
  type ModelProviderMetadata,
  type ModelProviderListItem,
  type McpServerSettingsItem,
  type PresetItem,
  type ProviderModelsFailedData,
  type ProviderModelsSnapshotData,
  type SessionHistoryStepsData,
  type RunCancellationProgressData,
  type UploadAttachmentData,
  type UserProfileData,
  type SystemToolSettingsItem,
  type SystemExtensionSettingsItem,
} from "../api/eventTypes";

export { DEFAULT_SESSION_TITLE } from "./session/defaults";
export { DEFAULT_USER_PROFILE, normalizeUserProfile } from "./session/userProfile";
export { applyEvent, friendlyDecisionKind } from "./session/sessionProjector";
export type { UserProfile } from "./session/userProfile";

// =========================
// 状态模型
// =========================

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
  "understand" | "prompt" | "model" | "decision" | "delegation" | "tool" | "retry" | "answer" | "error";

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
  toolOrigin?: import("../api/eventTypes").ToolEventOrigin;
  callId?: string;
  toolBatch?: TimelineToolBatch;
  purpose?: string;
  toolArgs?: unknown;
  toolPreview?: string;
  toolPresentation?: import("../api/eventTypes").ToolResultPresentation;
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
}

export interface RunActivityRecord {
  id: string;
  parentId?: string;
  activity: import("../api/eventTypes").RunActivity;
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
  liveActivity?: import("../api/eventTypes").RunActivity;
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
  forkOrigin?: {
    sourceSessionId: string;
    throughRequestId: string;
  };
}

export type HistoryReplayEntry = {
  entry: ConversationEntryDto;
  visible?: { kind: string; text: string };
};

export interface StoreState {
  sessions: Record<string, SessionRecord>;
  sessionOrder: string[];
  activeSessionId: string | null;
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
  activePresetName: string | null;
  presetsEnabled: boolean;
  presetRootDir: string;
  configSnapshot: ConfigSnapshotData | null;
  systemTools: SystemToolSettingsItem[];
  systemExtensions: SystemExtensionSettingsItem[];
  mcpServers: McpServerSettingsItem[];
  toolSettingsSynced: { systemTools: boolean; mcpServers: boolean };
  userProfile: UserProfile;
  /** 各目录快照是否已到达过一次；用于区分"尚未同步"与"确实为空"，避免空态闪现 */
  catalogSynced: { sessions: boolean; presets: boolean };
  /** 连接切换时清除目录同步屏障，直到新的权威快照到达。 */
  resetCatalogSyncState: () => void;

  selectSession: (id: string) => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  setDefaultSidebarCollapsed: (collapsed: boolean) => void;
  setDefaultRightPanelCollapsed: (collapsed: boolean) => void;
  setWorkflowDockWidth: (width: number) => void;
  setMotionLevel: (level: MotionLevel) => void;
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

// =========================
// 工具函数
// =========================

const nowIso = (): string => new Date().toISOString();

// =========================
// Store（Immer 中间件——所有 mutation 都自动产生新引用）
// =========================

export const useStore = create<StoreState>()(
  persist(
    immer((set) => ({
      sessions: {},
      sessionOrder: [],
      activeSessionId: null,
      sidebarCollapsed: false,
      rightPanelCollapsed: true,
      defaultSidebarCollapsed: false,
      defaultRightPanelCollapsed: true,
      workflowDockWidth: DEFAULT_WORKFLOW_DOCK_WIDTH,
      motionLevel: "full",
      viewedRunIdBySession: {},
      historyLoadedIds: {},
      historyLoadingIds: {},
      historyFailedIds: {},
      historyReplayBuffers: {},
      historyStepBuffers: {},
      historyEventRunIds: {},
      historyActiveRequestIds: {},
      processedEventIds: {},
      processedEventIdOrder: [],
      missingOnServerIds: {},
      pendingCreatedSessionIds: {},
      pendingDeletedSessionIds: {},
      childSessionParentIds: {},
      modelProviders: [],
      providerModelCatalogs: {},
      providerModelErrors: {},
      selectedModelProviderId: null,
      defaultModelProviderId: null,
      selectedModelProviderIdsBySession: {},
      executionApprovalMode: ExecutionApprovalModes.Agent,
      presets: [],
      activePresetName: null,
      presetsEnabled: true,
      presetRootDir: "",
      configSnapshot: null,
      systemTools: [],
      systemExtensions: [],
      mcpServers: [],
      toolSettingsSynced: { systemTools: false, mcpServers: false },
      userProfile: DEFAULT_USER_PROFILE,
      catalogSynced: { sessions: false, presets: false },

      resetCatalogSyncState: () =>
        set((state) => {
          state.catalogSynced.sessions = false;
          state.catalogSynced.presets = false;
        }),

      selectSession: (id) =>
        set((state) => {
          state.activeSessionId = id;
          syncActiveSessionModelSelection(state);
        }),

      toggleSidebar: () =>
        set((state) => {
          state.sidebarCollapsed = !state.sidebarCollapsed;
        }),

      toggleRightPanel: () =>
        set((state) => {
          state.rightPanelCollapsed = !state.rightPanelCollapsed;
        }),

      setSidebarCollapsed: (collapsed) =>
        set((state) => {
          state.sidebarCollapsed = collapsed;
        }),

      setRightPanelCollapsed: (collapsed) =>
        set((state) => {
          state.rightPanelCollapsed = collapsed;
        }),

      setDefaultSidebarCollapsed: (collapsed) =>
        set((state) => {
          state.defaultSidebarCollapsed = collapsed;
          state.sidebarCollapsed = collapsed;
        }),

      setDefaultRightPanelCollapsed: (collapsed) =>
        set((state) => {
          state.defaultRightPanelCollapsed = collapsed;
          state.rightPanelCollapsed = collapsed;
        }),

      setWorkflowDockWidth: (width) =>
        set((state) => {
          state.workflowDockWidth = clampWorkflowDockWidth(width);
        }),

      setMotionLevel: (level) =>
        set((state) => {
          state.motionLevel = level;
        }),

      setViewedRun: (sessionId, requestId) =>
        set((state) => {
          if (requestId) {
            state.viewedRunIdBySession[sessionId] = requestId;
          } else {
            delete state.viewedRunIdBySession[sessionId];
          }
        }),

      registerCreatingSession: (sessionId, title, modelProviderId) =>
        set((state) => {
          delete state.pendingDeletedSessionIds[sessionId];
          state.pendingCreatedSessionIds[sessionId] = true;
          const initialModelId = modelProviderId ?? state.defaultModelProviderId;
          if (initialModelId) {
            state.selectedModelProviderIdsBySession[sessionId] = initialModelId;
          }
          if (state.sessions[sessionId]) {
            if (!state.sessionOrder.includes(sessionId)) {
              state.sessionOrder.unshift(sessionId);
            }
            state.activeSessionId = sessionId;
            syncActiveSessionModelSelection(state);
            return;
          }
          state.sessions[sessionId] = {
            sessionId,
            title: title ?? DEFAULT_SESSION_TITLE,
            status: "creating",
            createdAt: nowIso(),
            updatedAt: nowIso(),
            entryCount: 0,
            messageCount: 0,
            messages: [],
            runs: [],
          };
          state.sessionOrder.unshift(sessionId);
          state.activeSessionId = sessionId;
          syncActiveSessionModelSelection(state);
        }),

      renameSession: (sessionId, title) =>
        set((state) => {
          const session = state.sessions[sessionId];
          if (session) session.title = title;
        }),

      markApprovalResolutionPending: (approvalId, decision) =>
        set((state) => {
          for (const session of Object.values(state.sessions)) {
            for (const run of session.runs) {
              const approval = run.approvals?.find((entry) => entry.approvalId === approvalId);
              if (!approval || approval.status !== "pending") continue;
              approval.resolutionPending = decision !== undefined;
              approval.pendingDecision = decision;
              run.revision += 1;
              return;
            }
          }
        }),

      markApprovalBatchResolutionPending: (batch, decision) =>
        set((state) => {
          const session = state.sessions[batch.sessionId];
          const run = session?.runs.find((entry) => entry.requestId === batch.requestId);
          if (!run) return;
          let changed = false;
          for (const approval of run.approvals ?? []) {
            if (approval.batchId !== batch.batchId || approval.status !== "pending") continue;
            approval.resolutionPending = decision !== undefined;
            approval.pendingDecision = decision;
            changed = true;
          }
          if (changed) run.revision += 1;
        }),

      markInteractionInputResolutionPending: (interactionId, action) =>
        set((state) => {
          for (const session of Object.values(state.sessions)) {
            for (const run of session.runs) {
              const interaction = run.interactionInputs?.find((entry) => entry.interactionId === interactionId);
              if (!interaction || interaction.status === "resolved") continue;
              interaction.resolutionPending = action !== undefined;
              interaction.pendingAction = action;
              run.revision += 1;
              return;
            }
          }
        }),

      removeSession: (sessionId) =>
        set((state) => {
          markSessionDeletionRequested(state, [sessionId]);
          syncActiveSessionModelSelection(state);
        }),

      clearAllSessions: (sessionIds) =>
        set((state) => {
          const ids = [...new Set(sessionIds?.length ? sessionIds : state.sessionOrder)];
          markSessionDeletionRequested(state, ids);
          syncActiveSessionModelSelection(state);
        }),

      markHistoryLoading: (sessionId) =>
        set((state) => {
          state.historyLoadingIds[sessionId] = true;
          state.historyReplayBuffers[sessionId] = [];
          state.historyStepBuffers[sessionId] = [];
          state.historyEventRunIds[sessionId] = {};
          state.historyActiveRequestIds[sessionId] = state.sessions[sessionId]?.activeRequestId ?? null;
          delete state.historyFailedIds[sessionId];
        }),

      markHistoryLoadFailed: (sessionId) =>
        set((state) => {
          state.historyLoadingIds[sessionId] = false;
          state.historyFailedIds[sessionId] = true;
          delete state.historyReplayBuffers[sessionId];
          delete state.historyStepBuffers[sessionId];
          delete state.historyEventRunIds[sessionId];
          delete state.historyActiveRequestIds[sessionId];
        }),

      selectModelProvider: (id) =>
        set((state) => {
          selectModelForActiveSession(state, id);
        }),

      applyDefaultModelToActiveSession: () =>
        set((state) => {
          applyDefaultModelToActiveSession(state);
        }),

      setExecutionApprovalMode: (mode) =>
        set((state) => {
          state.executionApprovalMode = mode;
        }),

      setUserProfile: (profile) =>
        set((state) => {
          state.userProfile = normalizeUserProfile({
            ...profile,
            updatedAt: new Date().toISOString(),
            syncState: "pending",
          });
        }),

      markUserProfileSynced: (profile) =>
        set((state) => {
          const snapshot = normalizeUserProfile(profile ?? state.userProfile);
          const current = normalizeUserProfile(state.userProfile);
          const isCurrentPending = current.syncState === "pending";
          const snapshotMatchesCurrent =
            snapshot.name === current.name && snapshot.avatarDataUrl === current.avatarDataUrl;
          if (isCurrentPending && !snapshotMatchesCurrent) return;
          state.userProfile = {
            ...snapshot,
            syncState: "synced",
          };
        }),

      replaceWithDevMockData: (mockSessions, activeSessionId) =>
        set((state) => {
          if (!import.meta.env.DEV) return;
          state.sessions = {};
          state.sessionOrder = [];
          state.viewedRunIdBySession = {};
          state.historyLoadedIds = {};
          state.historyLoadingIds = {};
          state.historyFailedIds = {};
          state.historyReplayBuffers = {};
          state.historyStepBuffers = {};
          state.historyEventRunIds = {};
          state.historyActiveRequestIds = {};
          state.missingOnServerIds = {};
          state.pendingCreatedSessionIds = {};
          state.pendingDeletedSessionIds = {};
          state.childSessionParentIds = {};
          state.selectedModelProviderIdsBySession = {};
          for (const session of mockSessions) {
            state.sessions[session.sessionId] = session;
            state.sessionOrder.push(session.sessionId);
            state.historyLoadedIds[session.sessionId] = true;
          }
          state.activeSessionId =
            activeSessionId && state.sessions[activeSessionId] ? activeSessionId : (state.sessionOrder[0] ?? null);
          syncActiveSessionModelSelection(state);
        }),

      appendUserMessage: (sessionId, requestId, input, attachments, options) =>
        set((state) => {
          if (state.historyLoadingIds[sessionId]) return;
          const session = state.sessions[sessionId];
          if (!session) return;
          if (session.messages.length === 0) {
            session.title = truncate(input, 24);
          }
          session.updatedAt = nowIso();
          session.messages.push({
            id: `${requestId}-user`,
            role: "user",
            content: input,
            attachments,
            createdAt: nowIso(),
            requestId,
          });
          bumpSessionMessageCount(session);
          if (options?.createRun !== false) {
            session.activeRequestId = requestId;
            session.runs.push(createRunRecord({ requestId, startedAt: nowIso(), input }));
          }
        }),

      truncateFromRequest: (sessionId, fromRequestId) =>
        set((state) => {
          truncateSessionFromRequest(state, sessionId, fromRequestId);
        }),

      advanceStreamingDisplay: (sessionId, requestId) => {
        let pending = false;
        set((state) => {
          const run = state.sessions[sessionId]?.runs.find((item) => item.requestId === requestId);
          if (!run) return;
          pending = advanceRunDisplayText(run, state.motionLevel);
        });
        return pending;
      },

      ingest: (env) =>
        set((state) => {
          applyEvent(state, env);
          syncActiveSessionModelSelection(state);
        }),

      ingestMany: (events) => {
        if (events.length === 0) return;
        set((state) => {
          for (const env of events) applyEvent(state, env);
          syncActiveSessionModelSelection(state);
        });
      },
    })),
    sessionPersistOptions,
  ),
);

installSessionPreferenceSynchronization({
  read: useStore.getState,
  update: (state) => useStore.setState(state),
});

export { clearPersistedStore };
