import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { DEFAULT_SESSION_TITLE } from "./session/defaults";
import { clearPersistedStore, sessionPersistOptions } from "./session/persistence";
import {
  applyEvent,
  bumpSessionMessageCount,
  createRunRecord,
  deleteSessionRuntimeState,
  truncate,
} from "./session/sessionProjector";
import {
  DEFAULT_USER_PROFILE,
  normalizeUserProfile,
  type UserProfile,
} from "./session/userProfile";
import {
  type ConversationEntryDto,
  type ConversationEntryMetadata,
  type EventEnvelope,
  type ModelProviderMetadata,
  type ModelProviderListItem,
  type SessionHistoryStepsData,
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
  kind?: "FinalAnswer" | "AskUser" | "Error";
  /** 后端 conversation entry 的 requestId——用于 truncate_from（删除 / 重新回答） */
  requestId?: string;
  metadata?: ConversationEntryMetadata;
}

export type TimelineStepKind =
  | "understand"
  | "prompt"
  | "model"
  | "decision"
  | "tool"
  | "retry"
  | "answer"
  | "error";

export type TimelineStepStatus = "pending" | "running" | "done" | "failed";

export interface TimelineStep {
  id: string;
  kind: TimelineStepKind;
  title: string;
  description?: string;
  status: TimelineStepStatus;
  startedAt: string;
  endedAt?: string;
  toolName?: string;
  callId?: string;
  toolArgs?: unknown;
  toolPreview?: string;
  toolResult?: unknown;
  toolErrorMessage?: string;
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
  /** decision.xml.progress 累积（清洗后的 XML） */
  xmlPreview: string;
  /** 后端实时解析出的"用户可见文本"——直接用于打字机效果 */
  visibleText: string;
  visibleKind: "final_answer" | "ask_user" | "tool_calls" | "unknown";
  expectedOutputMode: "unknown" | "final_text" | "tool_call_xml";
  decisionMode: "none" | "tool_candidate" | "final_text";
  /** 通过 decision.parsed.detail 暂存的工具参数 */
  pendingToolArgsByName: Record<string, unknown>;
  modelProvider?: ModelProviderMetadata;
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
  /** 已确认不在后端存在、仅本地残留的 sessionId */
  missingOnServerIds: Record<string, boolean>;
  /** 本地刚创建、尚未被 session.list 快照确认的 sessionId */
  pendingCreatedSessionIds: Record<string, boolean>;
  /** 本地已请求删除、尚未被 session.list 快照确认消失的 sessionId */
  pendingDeletedSessionIds: Record<string, boolean>;
  modelProviders: ModelProviderListItem[];
  selectedModelProviderId: string | null;
  userProfile: UserProfile;

  selectSession: (id: string) => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  setViewedRun: (sessionId: string, requestId: string | undefined) => void;
  registerCreatingSession: (sessionId: string, title?: string) => void;
  renameSession: (sessionId: string, title: string) => void;
  appendUserMessage: (sessionId: string, requestId: string, input: string) => void;
  ingest: (env: EventEnvelope) => void;
  removeSession: (sessionId: string) => void;
  clearAllSessions: (sessionIds?: string[]) => void;
  markHistoryLoading: (sessionId: string) => void;
  markHistoryLoadFailed: (sessionId: string) => void;
  selectModelProvider: (id: string) => void;
  setUserProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
  markUserProfileSynced: (profile?: UserProfileData) => void;
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
      rightPanelCollapsed: false,
      viewedRunIdBySession: {},
      historyLoadedIds: {},
      historyLoadingIds: {},
      historyFailedIds: {},
      historyReplayBuffers: {},
      historyStepBuffers: {},
      missingOnServerIds: {},
      pendingCreatedSessionIds: {},
      pendingDeletedSessionIds: {},
      modelProviders: [],
      selectedModelProviderId: null,
      userProfile: DEFAULT_USER_PROFILE,

    selectSession: (id) =>
      set((state) => {
        state.activeSessionId = id;
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

    setViewedRun: (sessionId, requestId) =>
      set((state) => {
        if (requestId) {
          state.viewedRunIdBySession[sessionId] = requestId;
        } else {
          delete state.viewedRunIdBySession[sessionId];
        }
      }),

    registerCreatingSession: (sessionId, title) =>
      set((state) => {
        delete state.pendingDeletedSessionIds[sessionId];
        state.pendingCreatedSessionIds[sessionId] = true;
        if (state.sessions[sessionId]) {
          if (!state.sessionOrder.includes(sessionId)) {
            state.sessionOrder.unshift(sessionId);
          }
          state.activeSessionId = sessionId;
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
        state.sessionOrder = state.sessionOrder.filter((id) => id !== sessionId);
        if (state.activeSessionId === sessionId) {
          state.activeSessionId = state.sessionOrder[0] ?? null;
        }
      }),

    clearAllSessions: (sessionIds) =>
      set((state) => {
        const ids = sessionIds?.length ? sessionIds : state.sessionOrder;
        for (const id of ids) {
          state.pendingDeletedSessionIds[id] = true;
          delete state.pendingCreatedSessionIds[id];
          deleteSessionRuntimeState(state, id);
        }
        if (state.activeSessionId && !state.sessions[state.activeSessionId]) {
          state.activeSessionId = state.sessionOrder[0] ?? null;
        }
      }),

    markHistoryLoading: (sessionId) =>
      set((state) => {
        state.historyLoadingIds[sessionId] = true;
        state.historyReplayBuffers[sessionId] = [];
        delete state.historyFailedIds[sessionId];
      }),

    markHistoryLoadFailed: (sessionId) =>
      set((state) => {
        state.historyLoadingIds[sessionId] = false;
        state.historyFailedIds[sessionId] = true;
        delete state.historyReplayBuffers[sessionId];
        delete state.historyStepBuffers[sessionId];
      }),

    selectModelProvider: (id) =>
      set((state) => {
        state.selectedModelProviderId = id;
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
          snapshot.name === current.name &&
          snapshot.avatarDataUrl === current.avatarDataUrl;
        if (isCurrentPending && !snapshotMatchesCurrent) return;
        state.userProfile = {
          ...snapshot,
          syncState: "synced",
        };
      }),

    appendUserMessage: (sessionId, requestId, input) =>
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
          createdAt: nowIso(),
          requestId,
        });
        bumpSessionMessageCount(session);
        session.activeRequestId = requestId;
        session.runs.push(createRunRecord({ requestId, startedAt: nowIso(), input }));
      }),

      ingest: (env) =>
        set((state) => {
          applyEvent(state, env);
        }),
    })),
    sessionPersistOptions,
  ),
);
export { clearPersistedStore };
