import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { DEFAULT_SESSION_TITLE } from "./session/defaults";
import {
  PERSIST_KEY,
  clearPersistedStore,
  readPersistedSessionPreferences,
  sessionPersistOptions,
} from "./session/persistence";
import {
  advanceRunDisplayText,
  applyEvent,
  bumpSessionMessageCount,
  createRunRecord,
  deleteSessionRuntimeState,
  truncate,
} from "./session/sessionProjector";
import {
  applyDefaultModelToActiveSession,
  selectModelForActiveSession,
  syncActiveSessionModelSelection,
} from "./session/sessionModelSelection";
import { DEFAULT_USER_PROFILE, normalizeUserProfile, type UserProfile } from "./session/userProfile";
import type { MotionLevel } from "../shared/motion";
import {
  type ConversationEntryDto,
  type ConversationEntryMetadata,
  type ConfigSnapshotData,
  type EventEnvelope,
  type ApprovalRequestedData,
  type ApprovalResolvedData,
  type ApprovalSubjectData,
  type ModelProviderMetadata,
  type ModelProviderListItem,
  type PresetItem,
  type ProviderModelsFailedData,
  type ProviderModelsSnapshotData,
  type PluginConfigItem,
  type SessionHistoryStepsData,
  type UploadAttachmentData,
  type UserProfileData,
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
  "understand" | "prompt" | "model" | "pi" | "decision" | "tool" | "retry" | "answer" | "error";

export type TimelineStepStatus = "pending" | "running" | "done" | "failed";

export interface TimelineStepScope {
  parentRequestId?: string;
  workflowName?: string;
  jobId?: string;
  agentName?: string;
  role?: "childAgent" | "merge";
}

export interface TimelineToolBatch {
  id: string;
  index?: number;
  size?: number;
  executionMode?: "parallel" | "sequential";
}

export interface TimelineStep {
  id: string;
  kind: TimelineStepKind;
  title: string;
  description?: string;
  status: TimelineStepStatus;
  startedAt: string;
  endedAt?: string;
  scope?: TimelineStepScope;
  toolName?: string;
  callId?: string;
  toolBatch?: TimelineToolBatch;
  toolArgs?: unknown;
  toolPreview?: string;
  toolPresentation?: import("../api/eventTypes").ToolResultPresentation;
  toolResult?: unknown;
  toolErrorMessage?: string;
  detailJson?: unknown;
  retryAttempt?: number;
  retryCode?: string;
  errorMessage?: string;
  modelName?: string;
  traceSource?: string;
  eventType?: string;
  promptChars?: number;
  promptLines?: number;
  promptTokenCount?: number;
  decisionKind?: string;
  xmlRoot?: string;
}

export interface RunRecord {
  requestId: string;
  /** 单调递增的运行态版本；UI 用它感知 run 变化，不依赖具体字段 */
  revision: number;
  startedAt: string;
  endedAt?: string;
  status: "running" | "completed" | "failed" | "cancelled";
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
  visibleKind: "final_answer" | "ask_user" | "tool_calls" | "unknown";
  expectedOutputMode: "unknown" | "final_text" | "open";
  decisionMode: "none" | "tool_candidate" | "final_text";
  /** 工具参数暂存，供工具节点显示 */
  pendingToolArgsByName: Record<string, unknown>;
  approvals?: ApprovalRunRecord[];
  modelProvider?: ModelProviderMetadata;
  recoverySource?: "history";
}

export interface ApprovalRunRecord {
  approvalId: string;
  approvalKind: ApprovalRequestedData["approvalKind"];
  status: ApprovalRequestedData["status"] | ApprovalResolvedData["status"];
  title: string;
  reason: string;
  rule?: string;
  riskSignals?: string[];
  subject: ApprovalSubjectData;
  createdAt: string;
  resolvedAt?: string;
  message?: string;
  scope?: ApprovalResolvedData["scope"];
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
  /** 已确认不在后端存在、仅本地残留的 sessionId */
  missingOnServerIds: Record<string, boolean>;
  /** 本地刚创建、尚未被 session.list 快照确认的 sessionId */
  pendingCreatedSessionIds: Record<string, boolean>;
  /** 本地已请求删除、尚未被 session.list 快照确认消失的 sessionId */
  pendingDeletedSessionIds: Record<string, boolean>;
  modelProviders: ModelProviderListItem[];
  providerModelCatalogs: Record<string, ProviderModelsSnapshotData>;
  providerModelErrors: Record<string, ProviderModelsFailedData & { updatedAt: string }>;
  /** Current active conversation's model. Kept for existing command/UI contracts. */
  selectedModelProviderId: string | null;
  /** Authoritative default model from model.list; used when creating a new conversation. */
  defaultModelProviderId: string | null;
  /** Local per-conversation selections. The backend still receives the chosen id per request. */
  selectedModelProviderIdsBySession: Record<string, string>;
  pluginConfigs: PluginConfigItem[];
  presets: PresetItem[];
  activePresetName: string | null;
  presetsEnabled: boolean;
  presetRootDir: string;
  configSnapshot: ConfigSnapshotData | null;
  userProfile: UserProfile;

  selectSession: (id: string) => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  setDefaultSidebarCollapsed: (collapsed: boolean) => void;
  setDefaultRightPanelCollapsed: (collapsed: boolean) => void;
  setMotionLevel: (level: MotionLevel) => void;
  setViewedRun: (sessionId: string, requestId: string | undefined) => void;
  registerCreatingSession: (sessionId: string, title?: string, modelProviderId?: string | null) => void;
  renameSession: (sessionId: string, title: string) => void;
  appendUserMessage: (
    sessionId: string,
    requestId: string,
    input: string,
    attachments?: UploadAttachmentData[],
    options?: { createRun?: boolean },
  ) => void;
  advanceStreamingDisplay: (sessionId: string, requestId: string) => boolean;
  ingest: (env: EventEnvelope) => void;
  removeSession: (sessionId: string) => void;
  clearAllSessions: (sessionIds?: string[]) => void;
  markHistoryLoading: (sessionId: string) => void;
  markHistoryLoadFailed: (sessionId: string) => void;
  selectModelProvider: (id: string) => void;
  applyDefaultModelToActiveSession: () => void;
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
      motionLevel: "full",
      viewedRunIdBySession: {},
      historyLoadedIds: {},
      historyLoadingIds: {},
      historyFailedIds: {},
      historyReplayBuffers: {},
      historyStepBuffers: {},
      historyEventRunIds: {},
      missingOnServerIds: {},
      pendingCreatedSessionIds: {},
      pendingDeletedSessionIds: {},
      modelProviders: [],
      providerModelCatalogs: {},
      providerModelErrors: {},
      selectedModelProviderId: null,
      defaultModelProviderId: null,
      selectedModelProviderIdsBySession: {},
      pluginConfigs: [],
      presets: [],
      activePresetName: null,
      presetsEnabled: true,
      presetRootDir: "",
      configSnapshot: null,
      userProfile: DEFAULT_USER_PROFILE,

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

      removeSession: (sessionId) =>
        set((state) => {
          state.pendingDeletedSessionIds[sessionId] = true;
          delete state.pendingCreatedSessionIds[sessionId];
          delete state.sessions[sessionId];
          delete state.selectedModelProviderIdsBySession[sessionId];
          state.sessionOrder = state.sessionOrder.filter((id) => id !== sessionId);
          if (state.activeSessionId === sessionId) {
            state.activeSessionId = state.sessionOrder[0] ?? null;
          }
          syncActiveSessionModelSelection(state);
        }),

      clearAllSessions: (sessionIds) =>
        set((state) => {
          const ids = sessionIds?.length ? sessionIds : state.sessionOrder;
          for (const id of ids) {
            state.pendingDeletedSessionIds[id] = true;
            delete state.pendingCreatedSessionIds[id];
            delete state.selectedModelProviderIdsBySession[id];
            deleteSessionRuntimeState(state, id);
          }
          if (state.activeSessionId && !state.sessions[state.activeSessionId]) {
            state.activeSessionId = state.sessionOrder[0] ?? null;
          }
          syncActiveSessionModelSelection(state);
        }),

      markHistoryLoading: (sessionId) =>
        set((state) => {
          state.historyLoadingIds[sessionId] = true;
          state.historyReplayBuffers[sessionId] = [];
          state.historyStepBuffers[sessionId] = [];
          state.historyEventRunIds[sessionId] = {};
          delete state.historyFailedIds[sessionId];
        }),

      markHistoryLoadFailed: (sessionId) =>
        set((state) => {
          state.historyLoadingIds[sessionId] = false;
          state.historyFailedIds[sessionId] = true;
          delete state.historyReplayBuffers[sessionId];
          delete state.historyStepBuffers[sessionId];
          delete state.historyEventRunIds[sessionId];
        }),

      selectModelProvider: (id) =>
        set((state) => {
          selectModelForActiveSession(state, id);
        }),

      applyDefaultModelToActiveSession: () =>
        set((state) => {
          applyDefaultModelToActiveSession(state);
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
          state.missingOnServerIds = {};
          state.pendingCreatedSessionIds = {};
          state.pendingDeletedSessionIds = {};
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
    })),
    sessionPersistOptions,
  ),
);

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== PERSIST_KEY) return;
    const preferences = readPersistedSessionPreferences(event.newValue);
    if (!preferences) return;
    const state = useStore.getState();
    const nextDefaultSidebarCollapsed = preferences.defaultSidebarCollapsed ?? state.defaultSidebarCollapsed;
    const nextDefaultRightPanelCollapsed = preferences.defaultRightPanelCollapsed ?? state.defaultRightPanelCollapsed;
    const nextMotionLevel = preferences.motionLevel ?? state.motionLevel;
    const nextSelectedModelProviderId = preferences.selectedModelProviderId ?? state.selectedModelProviderId;
    const nextSelectedModelProviderIdsBySession =
      preferences.selectedModelProviderIdsBySession ?? state.selectedModelProviderIdsBySession;
    if (
      nextDefaultSidebarCollapsed === state.defaultSidebarCollapsed &&
      nextDefaultRightPanelCollapsed === state.defaultRightPanelCollapsed &&
      nextMotionLevel === state.motionLevel &&
      nextSelectedModelProviderId === state.selectedModelProviderId &&
      nextSelectedModelProviderIdsBySession === state.selectedModelProviderIdsBySession
    ) {
      return;
    }
    useStore.setState({
      defaultSidebarCollapsed: nextDefaultSidebarCollapsed,
      defaultRightPanelCollapsed: nextDefaultRightPanelCollapsed,
      sidebarCollapsed: nextDefaultSidebarCollapsed,
      rightPanelCollapsed: nextDefaultRightPanelCollapsed,
      motionLevel: nextMotionLevel,
      selectedModelProviderId: nextSelectedModelProviderId,
      selectedModelProviderIdsBySession: nextSelectedModelProviderIdsBySession,
    });
  });
}
export { clearPersistedStore };
