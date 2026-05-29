import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {
  EventKinds,
  type EventEnvelope,
  type AskUserData,
  type ConversationEntryDto,
  type ConversationEntryMetadata,
  type DecisionParsedData,
  type DecisionParsedDetailData,
  type DecisionXmlProgressData,
  type DecisionXmlSummaryData,
  type FinalAnswerData,
  type ModelDeltaData,
  type ModelListSnapshotData,
  type ModelStartedData,
  type ModelProviderMetadata,
  type ModelProviderListItem,
  type RetryPlannedData,
  type RunFailedData,
  type RunStartedData,
  type SessionHistoryEntryData,
  type SessionHistoryStartedData,
  type SessionListItem,
  type SessionListSnapshotData,
  type SessionNotFoundData,
  type SessionSnapshotData,
  type SessionTruncatedData,
  type ToolCallCompletedData,
  type ToolCallFailedData,
  type ToolCallStartedData,
  type ToolCallsPlannedData,
  type ToolResultsDetailData,
  type UserProfileData,
} from "../api/eventTypes";

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

export type UserProfile = UserProfileData & {
  syncState?: "synced" | "pending";
};

interface StoreState {
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
  /** 已确认不在后端存在、仅本地残留的 sessionId */
  missingOnServerIds: Record<string, boolean>;
  /** 本地已经发起删除的 sessionId；用于过滤删除过程中的旧 session.list 快照 */
  locallyDeletedSessionIds: Record<string, boolean>;
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
  selectModelProvider: (id: string) => void;
  setUserProfile: (profile: Pick<UserProfile, "name" | "avatarDataUrl">) => void;
  markUserProfileSynced: (profile?: UserProfileData) => void;
}

// =========================
// 工具函数
// =========================

const nowIso = (): string => new Date().toISOString();

function truncate(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 默认会话标题——没有用户输入时显示 */
export const DEFAULT_SESSION_TITLE = "新对话";
export const DEFAULT_USER_PROFILE: UserProfile = {
  name: "用户",
  avatarDataUrl: null,
  updatedAt: "",
};

/** 把 decisionKind 翻译成中文用户语 */
export function friendlyDecisionKind(decisionKind: string): string {
  switch (decisionKind) {
    case "FinalAnswer":
      return "生成回复";
    case "ToolCalls":
      return "调用工具";
    case "AskUser":
      return "向用户提问";
    default:
      return decisionKind;
  }
}

function currentRun(session: SessionRecord, requestId?: string): RunRecord | undefined {
  if (!requestId) return session.runs[session.runs.length - 1];
  return session.runs.find((r) => r.requestId === requestId);
}

function syncSessionCountsFromLoadedMessages(session: SessionRecord): void {
  session.messageCount = session.messages.length;
}

function syncSessionCountsFromHistoryStart(
  session: SessionRecord,
  data: SessionHistoryStartedData,
): void {
  session.entryCount = data.totalEntries;
  session.messageCount = data.messageCount ?? session.messageCount;
}

function bumpSessionMessageCount(session: SessionRecord): void {
  session.messageCount = Math.max(session.messageCount, session.messages.length);
}

function normalizeUserProfile(value: unknown): UserProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_USER_PROFILE;
  const profile = value as Partial<UserProfile>;
  const name = typeof profile.name === "string" && profile.name.trim()
    ? profile.name.trim().slice(0, 48)
    : DEFAULT_USER_PROFILE.name;
  return {
    name,
    avatarDataUrl: typeof profile.avatarDataUrl === "string" && profile.avatarDataUrl.trim()
      ? profile.avatarDataUrl
      : null,
    updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : "",
    syncState: profile.syncState === "pending" ? "pending" : "synced",
  };
}

function createRunRecord(input: {
  requestId: string;
  startedAt: string;
  input: string;
}): RunRecord {
  return {
    requestId: input.requestId,
    revision: 0,
    startedAt: input.startedAt,
    status: "running",
    input: input.input,
    steps: [],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    visibleKind: "unknown",
    pendingToolArgsByName: {},
  };
}

function touchRun(run: RunRecord): void {
  run.revision = (run.revision ?? 0) + 1;
}

function ensureSession(state: StoreState, sessionId: string): SessionRecord {
  if (!state.sessions[sessionId]) {
    state.sessions[sessionId] = {
      sessionId,
      title: DEFAULT_SESSION_TITLE,
      status: "ready",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      entryCount: 0,
      messageCount: 0,
      messages: [],
      runs: [],
    };
    if (!state.sessionOrder.includes(sessionId)) {
      state.sessionOrder.unshift(sessionId);
    }
  }
  return state.sessions[sessionId];
}

function upsertStep(run: RunRecord, step: TimelineStep): void {
  const idx = run.steps.findIndex((s) => s.id === step.id);
  if (idx >= 0) {
    run.steps[idx] = { ...run.steps[idx], ...step };
  } else {
    run.steps.push(step);
  }
  touchRun(run);
}

// =========================
// Store（Immer 中间件——所有 mutation 都自动产生新引用）
// =========================

const PERSIST_KEY = "senera-frontend@v1";

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
      missingOnServerIds: {},
      locallyDeletedSessionIds: {},
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
        if (state.sessions[sessionId]) return;
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
        state.locallyDeletedSessionIds[sessionId] = true;
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
          state.locallyDeletedSessionIds[id] = true;
        }
        state.sessions = {};
        state.sessionOrder = [];
        state.activeSessionId = null;
        state.viewedRunIdBySession = {};
        state.historyLoadedIds = {};
        state.historyLoadingIds = {};
        state.missingOnServerIds = {};
      }),

    markHistoryLoading: (sessionId) =>
      set((state) => {
        state.historyLoadingIds[sessionId] = true;
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
    {
      name: PERSIST_KEY,
      version: 3,
      storage: createJSONStorage(() => localStorage),
      // 后端是 SSOT；前端只缓存 UI 偏好 + 会话元数据（标题/时间）。
      // messages 不持久化 —— 后端 session.history 会权威回放。
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        rightPanelCollapsed: state.rightPanelCollapsed,
        selectedModelProviderId: state.selectedModelProviderId,
        userProfile: state.userProfile,
      }),
      // 旧版本 localStorage 干净迁移
      migrate: (persisted: unknown, fromVersion: number) => {
        if (!persisted || typeof persisted !== "object") return persisted;
        const p = persisted as Partial<StoreState> & Record<string, unknown>;
        if (fromVersion < 2) {
          // v1 没有 viewedRunIdBySession / rightPanelCollapsed——补默认
          p.viewedRunIdBySession = (p.viewedRunIdBySession as Record<string, string>) ?? {};
          p.rightPanelCollapsed = (p.rightPanelCollapsed as boolean) ?? false;
        }
        // v3 起不再持久化会话目录与当前选中，启动后完全依赖后端恢复
        delete p.activeSessionId;
        delete p.sessionOrder;
        delete p.sessions;
        delete p.viewedRunIdBySession;
        delete p.modelProviders;
        return p;
      },
      // 即便 migrate 漏掉字段，merge 兜底
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<StoreState>;
        return {
          ...current,
          sidebarCollapsed: p.sidebarCollapsed ?? false,
          rightPanelCollapsed: p.rightPanelCollapsed ?? false,
          selectedModelProviderId: p.selectedModelProviderId ?? null,
          userProfile: normalizeUserProfile(p.userProfile),
          modelProviders: [],
          sessions: {},
          sessionOrder: [],
          activeSessionId: null,
          viewedRunIdBySession: {},
          // 这两个是运行时态，rehydrate 一律重置
          historyLoadedIds: {},
          historyLoadingIds: {},
          missingOnServerIds: {},
          locallyDeletedSessionIds: {},
        };
      },
    },
  ),
);

export function clearPersistedStore(): void {
  try {
    localStorage.removeItem(PERSIST_KEY);
  } catch {
    /* ignore */
  }
}

// =========================
// reducer：把 36 种事件投影到状态
// =========================

function applyEvent(state: StoreState, env: EventEnvelope): void {
  const sessionId = env.sessionId;

  switch (env.kind) {
    case EventKinds.ModelListSnapshot: {
      const data = env.data as ModelListSnapshotData;
      state.modelProviders = data.models;
      const selectedId = state.selectedModelProviderId;
      const selectedStillExists = selectedId
        ? data.models.some((model) => model.id === selectedId)
        : false;
      state.selectedModelProviderId = selectedStillExists
        ? selectedId
        : data.defaultModelProviderId;
      return;
    }

    case EventKinds.ProfileSnapshot: {
      if (state.userProfile.syncState === "pending") return;
      state.userProfile = normalizeUserProfile(env.data as UserProfileData);
      return;
    }

    case EventKinds.SessionCreated:
    case EventKinds.SessionSnapshot: {
      if (!sessionId) return;
      const data = env.data as SessionSnapshotData;
      const existing = state.sessions[sessionId];
      if (existing) {
        existing.status = "ready";
        existing.updatedAt = data.updatedAt ?? nowIso();
        existing.entryCount = data.entryCount;
        existing.messageCount = data.messageCount;
        existing.activeRequestId = data.activeRequestId;
      } else {
        state.sessions[sessionId] = {
          sessionId,
          title: DEFAULT_SESSION_TITLE,
          status: "ready",
          createdAt: data.createdAt ?? nowIso(),
          updatedAt: data.updatedAt ?? nowIso(),
          entryCount: data.entryCount,
          messageCount: data.messageCount,
          messages: [],
          runs: [],
          activeRequestId: data.activeRequestId,
        };
        if (!state.sessionOrder.includes(sessionId)) {
          state.sessionOrder.unshift(sessionId);
        }
      }
      delete state.missingOnServerIds[sessionId];
      if (!state.activeSessionId) state.activeSessionId = sessionId;
      return;
    }

    case EventKinds.SessionClosed: {
      if (!sessionId || !state.sessions[sessionId]) return;
      delete state.sessions[sessionId];
      state.sessionOrder = state.sessionOrder.filter((id) => id !== sessionId);
      delete state.historyLoadedIds[sessionId];
      delete state.historyLoadingIds[sessionId];
      delete state.viewedRunIdBySession[sessionId];
      delete state.missingOnServerIds[sessionId];
      delete state.locallyDeletedSessionIds[sessionId];
      if (state.activeSessionId === sessionId) {
        state.activeSessionId = state.sessionOrder[0] ?? null;
      }
      if (state.activeSessionId && !state.sessions[state.activeSessionId]) {
        state.activeSessionId = state.sessionOrder[0] ?? null;
      }
      return;
    }

    case EventKinds.RunStarted: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const data = env.data as RunStartedData;
      let run = currentRun(session, env.requestId);
      if (!run) {
        run = createRunRecord({
          requestId: env.requestId ?? "unknown",
          startedAt: env.timestamp,
          input: data.input,
        });
        session.runs.push(run);
      } else {
        run.status = "running";
      }
      upsertStep(run, {
        id: `${run.requestId}-understand`,
        kind: "understand",
        title: "理解用户问题",
        description: truncate(data.input, 60),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
      });
      session.activeRequestId = run.requestId;
      session.updatedAt = env.timestamp;
      delete state.viewedRunIdBySession[sessionId];
      return;
    }

    case EventKinds.RunCompleted: {
      if (!sessionId) return;
      const session = state.sessions[sessionId];
      if (!session) return;
      const run = currentRun(session, env.requestId);
      if (!run) return;
      run.status = "completed";
      run.endedAt = env.timestamp;
      touchRun(run);
      session.activeRequestId = undefined;
      session.updatedAt = env.timestamp;
      return;
    }

    case EventKinds.RunFailed: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const data = env.data as RunFailedData;
      const run = currentRun(session, env.requestId);
      if (run) {
        run.status = "failed";
        run.endedAt = env.timestamp;
        upsertStep(run, {
          id: `${run.requestId}-error`,
          kind: "error",
          title: "运行失败",
          description: data.message,
          status: "failed",
          startedAt: env.timestamp,
          endedAt: env.timestamp,
          errorMessage: data.message,
        });
      }
      session.messages.push({
        id: `${env.requestId ?? "run"}-error`,
        role: "system",
        content: data.message,
        createdAt: env.timestamp,
        kind: "Error",
        requestId: env.requestId,
      });
      bumpSessionMessageCount(session);
      session.activeRequestId = undefined;
      return;
    }

    case EventKinds.RunCancelled: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (run) {
        run.status = "cancelled";
        run.endedAt = env.timestamp;
        run.streamingRaw = "";
        run.xmlPreview = "";
        run.visibleText = "";
        upsertStep(run, {
          id: `${run.requestId}-cancelled`,
          kind: "error",
          title: "已取消",
          description: "用户中断了本次运行。",
          status: "failed",
          startedAt: env.timestamp,
          endedAt: env.timestamp,
        });
      }
      session.activeRequestId = undefined;
      session.updatedAt = env.timestamp;
      return;
    }

    case EventKinds.PromptSummary: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as { chars: number; lines: number };
      upsertStep(run, {
        id: `${run.requestId}-prompt-${env.step ?? 0}`,
        kind: "prompt",
        title: `渲染 Prompt`,
        description: `第 ${env.step ?? 0} 步`,
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        promptChars: data.chars,
        promptLines: data.lines,
      });
      return;
    }

    case EventKinds.ModelStarted: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ModelStartedData;
      const modelName = data.provider?.title ?? data.model;
      run.modelProvider = data.provider;
      upsertStep(run, {
        id: `${run.requestId}-model-${env.step ?? 0}`,
        kind: "model",
        title: `调用模型`,
        description: `第 ${env.step ?? 0} 步`,
        status: "running",
        startedAt: env.timestamp,
        modelName,
      });
      return;
    }

    case EventKinds.ModelDelta: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ModelDeltaData;
      run.streamingRaw += data.text;
      run.visibleText = run.streamingRaw;
      run.visibleKind = "final_answer";
      touchRun(run);
      return;
    }

    case EventKinds.ModelCompleted: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const stepId = `${run.requestId}-model-${env.step ?? 0}`;
      const step = run.steps.find((s) => s.id === stepId);
      if (step) {
        step.status = "done";
        step.endedAt = env.timestamp;
        touchRun(run);
      }
      return;
    }

    case EventKinds.DecisionXmlProgress: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as DecisionXmlProgressData;
      run.xmlPreview = data.xml;
      run.visibleText = data.text;
      run.visibleKind = data.kind;
      touchRun(run);
      return;
    }

    case EventKinds.DecisionXmlSummary: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as DecisionXmlSummaryData;
      upsertStep(run, {
        id: `${run.requestId}-decision-xml-${env.step ?? 0}`,
        kind: "decision",
        title: `行动决策`,
        description: `${data.root ?? "?"} · ${data.chars} 字符${data.sanitized ? " · 已清洗" : ""}`,
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        xmlRoot: data.root,
      });
      return;
    }

    case EventKinds.DecisionParsed: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as DecisionParsedData;
      upsertStep(run, {
        id: `${run.requestId}-decision-${env.step ?? 0}`,
        kind: "decision",
        title: "确定行动",
        description: `${friendlyDecisionKind(data.decisionKind)}`,
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        decisionKind: data.decisionKind,
        xmlRoot: data.root,
      });
      return;
    }

    case EventKinds.DecisionParsedDetail: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as DecisionParsedDetailData;
      if (data.decisionKind === "ToolCalls" && data.payload && typeof data.payload === "object") {
        const payload = data.payload as { tool_calls?: Array<{ name?: string; arguments?: unknown }> };
        const calls = payload.tool_calls ?? [];
        for (const call of calls) {
          if (call.name) {
            run.pendingToolArgsByName[call.name] = call.arguments;
            touchRun(run);
          }
        }
      }
      const stepId = `${run.requestId}-decision-${env.step ?? 0}`;
      const step = run.steps.find((s) => s.id === stepId);
      if (step) {
        step.detailJson = data.payload;
        touchRun(run);
      }
      return;
    }

    case EventKinds.ToolCallsPlanned: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ToolCallsPlannedData;
      upsertStep(run, {
        id: `${run.requestId}-tool-plan-${env.step ?? 0}`,
        kind: "tool",
        title: `工具计划 · ${data.toolCount} 个`,
        description: data.tools.join(", "),
        status: "done",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
      });
      return;
    }

    case EventKinds.ToolCallStarted: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ToolCallStartedData;
      upsertStep(run, {
        id: `tool-${data.callId}`,
        kind: "tool",
        title: `调用 ${data.toolName}`,
        status: "running",
        startedAt: env.timestamp,
        toolName: data.toolName,
        callId: data.callId,
        toolArgs: run.pendingToolArgsByName[data.toolName],
      });
      return;
    }

    case EventKinds.ToolCallCompleted: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ToolCallCompletedData;
      const step = run.steps.find((s) => s.id === `tool-${data.callId}`);
      if (step) {
        step.status = "done";
        step.endedAt = env.timestamp;
        step.toolPreview = data.preview;
        touchRun(run);
      }
      return;
    }

    case EventKinds.ToolCallFailed: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ToolCallFailedData;
      const step = run.steps.find((s) => s.id === `tool-${data.callId}`);
      if (step) {
        step.status = "failed";
        step.endedAt = env.timestamp;
        step.toolErrorMessage = data.message;
        touchRun(run);
      } else {
        upsertStep(run, {
          id: `tool-${data.callId}`,
          kind: "tool",
          title: `调用 ${data.toolName} 失败`,
          status: "failed",
          startedAt: env.timestamp,
          endedAt: env.timestamp,
          toolName: data.toolName,
          callId: data.callId,
          toolErrorMessage: data.message,
        });
      }
      return;
    }

    case EventKinds.ToolResultsDetail: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as ToolResultsDetailData;
      if (Array.isArray(data.value)) {
        for (const entry of data.value) {
          const callId = (entry as { callId?: string })?.callId;
          if (!callId) continue;
          const step = run.steps.find((s) => s.id === `tool-${callId}`);
          if (step) {
            step.toolResult = entry;
            touchRun(run);
          }
        }
      }
      return;
    }

    case EventKinds.RetryPlanned: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      if (!run) return;
      const data = env.data as RetryPlannedData;
      upsertStep(run, {
        id: `${run.requestId}-retry-${data.attempt}`,
        kind: "retry",
        title: `重试 · 第 ${data.attempt} 次`,
        description: `${data.code} · ${data.message}`,
        status: data.retryable ? "done" : "failed",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        retryAttempt: data.attempt,
        retryCode: data.code,
      });
      return;
    }

    case EventKinds.FinalAnswer: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      const data = env.data as FinalAnswerData;
      session.messages.push({
        id: `${env.requestId ?? "final"}-answer`,
        role: "assistant",
        content: data.content,
        createdAt: env.timestamp,
        kind: "FinalAnswer",
        requestId: env.requestId,
        metadata: run?.modelProvider
          ? { run: { modelProvider: run.modelProvider } }
          : undefined,
      });
      bumpSessionMessageCount(session);
      if (run) {
        upsertStep(run, {
          id: `${run.requestId}-answer`,
          kind: "answer",
          title: "生成回复",
          description: truncate(data.content, 60),
          status: "done",
          startedAt: env.timestamp,
          endedAt: env.timestamp,
        });
        run.streamingRaw = "";
        run.xmlPreview = "";
        run.visibleText = "";
      }
      session.updatedAt = env.timestamp;
      // 这个会话挪到列表顶部
      state.sessionOrder = [sessionId, ...state.sessionOrder.filter((id) => id !== sessionId)];
      return;
    }

    case EventKinds.AskUser: {
      if (!sessionId) return;
      const session = ensureSession(state, sessionId);
      const run = currentRun(session, env.requestId);
      const data = env.data as AskUserData;
      session.messages.push({
        id: `${env.requestId ?? "ask"}-ask`,
        role: "assistant",
        content: data.question,
        createdAt: env.timestamp,
        kind: "AskUser",
        requestId: env.requestId,
        metadata: run?.modelProvider
          ? { run: { modelProvider: run.modelProvider } }
          : undefined,
      });
      bumpSessionMessageCount(session);
      if (run) {
        upsertStep(run, {
          id: `${run.requestId}-answer`,
          kind: "answer",
          title: "向用户提问",
          description: truncate(data.question, 60),
          status: "done",
          startedAt: env.timestamp,
          endedAt: env.timestamp,
        });
        run.streamingRaw = "";
        run.xmlPreview = "";
        run.visibleText = "";
      }
      return;
    }

    case EventKinds.SessionListSnapshot: {
      const data = env.data as SessionListSnapshotData;
      ingestSessionList(state, data.sessions);
      return;
    }

    case EventKinds.SessionHistoryStarted: {
      if (!sessionId) return;
      const data = env.data as SessionHistoryStartedData;
      const session = state.sessions[sessionId];
      if (!session) return;
      // 清空原有 messages，准备从后端回放（避免重复）
      session.messages = [];
      syncSessionCountsFromHistoryStart(session, data);
      state.historyLoadingIds[sessionId] = true;
      // total info 可用于显示进度，但目前未必需要
      void data;
      return;
    }

    case EventKinds.SessionHistoryEntry: {
      if (!sessionId) return;
      const data = env.data as SessionHistoryEntryData;
      const session = state.sessions[sessionId];
      if (!session) return;
      const message = projectEntryToMessage(data.entry, data.visible);
      if (message) {
        session.messages.push(message);
        syncSessionCountsFromLoadedMessages(session);
      }
      return;
    }

    case EventKinds.SessionHistoryCompleted: {
      if (!sessionId) return;
      if (!state.sessions[sessionId]) return;
      state.historyLoadingIds[sessionId] = false;
      state.historyLoadedIds[sessionId] = true;
      if (state.sessions[sessionId]) {
        syncSessionCountsFromLoadedMessages(state.sessions[sessionId]);
      }
      delete state.missingOnServerIds[sessionId];
      return;
    }

    case EventKinds.SessionNotFound: {
      if (!sessionId) return;
      const data = env.data as SessionNotFoundData;
      state.historyLoadingIds[sessionId] = false;
      if (data.operation === "session.history") {
        state.missingOnServerIds[sessionId] = true;
        delete state.historyLoadedIds[sessionId];
        if (state.sessions[sessionId]) {
          state.sessions[sessionId].messages = [];
          state.sessions[sessionId].runs = [];
          state.sessions[sessionId].entryCount = 0;
          state.sessions[sessionId].messageCount = 0;
        }
      }
      return;
    }

    case EventKinds.SessionTruncated: {
      if (!sessionId) return;
      const data = env.data as SessionTruncatedData;
      const session = state.sessions[sessionId];
      if (!session) return;
      // 删除从该 requestId 起的所有消息（含其本身）
      const idx = session.messages.findIndex((m) => m.requestId === data.fromRequestId);
      if (idx >= 0) {
        session.messages = session.messages.slice(0, idx);
        syncSessionCountsFromLoadedMessages(session);
      }
      // 同样清掉对应的 runs
      const runIdx = session.runs.findIndex((r) => r.requestId === data.fromRequestId);
      if (runIdx >= 0) {
        session.runs = session.runs.slice(0, runIdx);
      }
      const viewedRunId = state.viewedRunIdBySession[sessionId];
      if (viewedRunId && !session.runs.some((run) => run.requestId === viewedRunId)) {
        delete state.viewedRunIdBySession[sessionId];
      }
      session.updatedAt = env.timestamp;
      return;
    }

    default:
      return;
  }
}

// ---- 历史回放：把 conversation entry 投影成可见 message ----

function projectEntryToMessage(
  entry: ConversationEntryDto,
  visible?: { kind: string; text: string },
): ChatMessage | null {
  if (entry.kind === "user.message") {
    return {
      id: `${entry.requestId}-user`,
      role: "user",
      content: entry.content,
      createdAt: entry.timestamp,
      requestId: entry.requestId,
      metadata: entry.metadata,
    };
  }
  if (entry.kind === "assistant.decision") {
    if (!visible || !visible.text) return null;
    const isAsk = visible.kind === "ask_user";
    return {
      id: `${entry.requestId}-${isAsk ? "ask" : "answer"}`,
      role: "assistant",
      content: visible.text,
      createdAt: entry.timestamp,
      kind: isAsk ? "AskUser" : "FinalAnswer",
      requestId: entry.requestId,
      metadata: entry.metadata,
    };
  }
  return null;
}

// ---- session.list.snapshot：合并后端目录到本地 ----

function ingestSessionList(state: StoreState, items: SessionListItem[]): void {
  // 后端覆盖本地（后端是 SSOT）。不在后端列表中的本地残留会话直接清理。
  const visibleItems = items.filter((item) => !state.locallyDeletedSessionIds[item.sessionId]);
  const deletedIds = new Set(Object.keys(state.locallyDeletedSessionIds));
  for (const item of items) {
    if (!deletedIds.has(item.sessionId)) continue;
    delete state.sessions[item.sessionId];
    delete state.historyLoadedIds[item.sessionId];
    delete state.historyLoadingIds[item.sessionId];
    delete state.viewedRunIdBySession[item.sessionId];
    delete state.missingOnServerIds[item.sessionId];
  }

  const serverIds = new Set<string>();
  for (const item of visibleItems) {
    serverIds.add(item.sessionId);
    const existing = state.sessions[item.sessionId];
    if (existing) {
      existing.title = item.title;
      existing.status = item.status === "running" ? "ready" : (item.status as SessionRecord["status"]);
      existing.updatedAt = item.updatedAt;
      existing.createdAt = item.createdAt;
      existing.entryCount = item.entryCount;
      existing.messageCount = item.messageCount;
    } else {
      state.sessions[item.sessionId] = {
        sessionId: item.sessionId,
        title: item.title,
        status: "ready",
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        entryCount: item.entryCount,
        messageCount: item.messageCount,
        messages: [],
        runs: [],
      };
    }
    delete state.missingOnServerIds[item.sessionId];
  }

  // 重新排序：后端列表已按 updatedAt DESC 排序
  const serverOrdered = visibleItems.map((i) => i.sessionId);
  const localOnly = state.sessionOrder.filter((id) => !serverIds.has(id));
  state.sessionOrder = serverOrdered;

  if (state.activeSessionId && !serverIds.has(state.activeSessionId) && serverOrdered.length > 0) {
    state.activeSessionId = serverOrdered[0];
  } else if (state.activeSessionId && !serverIds.has(state.activeSessionId) && serverOrdered.length === 0) {
    state.activeSessionId = null;
  } else if (!state.activeSessionId && state.sessionOrder.length > 0) {
    state.activeSessionId = state.sessionOrder[0];
  }

  for (const localId of localOnly) {
    delete state.sessions[localId];
    delete state.historyLoadedIds[localId];
    delete state.historyLoadingIds[localId];
    delete state.viewedRunIdBySession[localId];
    delete state.missingOnServerIds[localId];
  }
}
