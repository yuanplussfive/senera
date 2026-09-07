import { create } from "zustand";
import { persist } from "zustand/middleware";
import { clampWorkflowDockWidth, DEFAULT_WORKFLOW_DOCK_WIDTH } from "../shared/responsive/workflowDock";
import { immer } from "zustand/middleware/immer";
import { DEFAULT_SESSION_TITLE } from "./session/defaults";
import { clearPersistedStore, sessionPersistOptions, type PersistedSessionState } from "./session/persistence";
import { installSessionPreferenceSynchronization } from "./session/sessionPreferenceSync";
import {
  advanceRunDisplayText,
  applyEvent,
  bumpSessionMessageCount,
  createRunRecord,
  truncateSessionFromRequest,
  truncate,
  markSessionDeletionRequested,
  invalidateSessionHistoryCache,
} from "./session/sessionProjector";
import {
  applyDefaultModelToActiveSession,
  selectModelForActiveSession,
  syncActiveSessionModelSelection,
} from "./session/sessionModelSelection";
import { DEFAULT_USER_PROFILE, normalizeUserProfile } from "./session/userProfile";
import { ExecutionApprovalModes } from "../api/executionApprovalMode";
import type { SessionRecord, StoreState } from "./session/types";

export { DEFAULT_SESSION_TITLE } from "./session/defaults";
export { DEFAULT_USER_PROFILE, normalizeUserProfile } from "./session/userProfile";
export { applyEvent, friendlyDecisionKind } from "./session/sessionProjector";
export { readActiveRun } from "./session/sessionProjectorCore";
export type {
  ApprovalRunRecord,
  ChatMessage,
  HistoryReplayEntry,
  InteractionInputRunRecord,
  MessageRole,
  RunActivityRecord,
  RunRecord,
  SessionRecord,
  StoreState,
  TimelineChildRunMessage,
  TimelineChildRunState,
  TimelineChildRunTodo,
  TimelineChildRunTodoItem,
  TimelineChildRunTodoStatus,
  TimelineStep,
  TimelineStepKind,
  TimelineStepScope,
  TimelineStepStatus,
  TimelineToolBatch,
  TimelineToolOutput,
  TimelineToolProgress,
  SessionOrderPlacement,
  UserProfile,
} from "./session/types";

// =========================
// 工具函数
// =========================

const nowIso = (): string => new Date().toISOString();

// =========================
// Store（Immer 中间件——所有 mutation 都自动产生新引用）
// =========================

export const useStore = create<StoreState>()(
  persist<StoreState, [], [["zustand/immer", never]], PersistedSessionState>(
    immer<StoreState, [["zustand/persist", unknown]]>((set) => ({
      sessions: {},
      sessionOrder: [],
      activeSessionId: null,
      agenda: undefined,
      world: undefined,
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
      presetWorldPackages: [],
      activePresetName: null,
      presetsEnabled: true,
      presetRootDir: "",
      configSnapshot: null,
      systemTools: [],
      systemExtensions: [],
      mcpServers: [],
      toolSettingsSynced: { systemTools: false, mcpServers: false },
      channelStatuses: [],
      userProfile: DEFAULT_USER_PROFILE,
      catalogSynced: { sessions: false, presets: false },

      resetCatalogSyncState: () =>
        set((state) => {
          state.catalogSynced.sessions = false;
          state.catalogSynced.presets = false;
        }),

      invalidateSessionHistoryCache: () =>
        set((state) => {
          invalidateSessionHistoryCache(state);
        }),

      selectSession: (id) =>
        set((state) => {
          state.activeSessionId = id;
          syncActiveSessionModelSelection(state);
        }),

      moveSession: (sessionId, targetSessionId, placement) =>
        set((state) => {
          if (sessionId === targetSessionId) return;
          const sourceIndex = state.sessionOrder.indexOf(sessionId);
          const targetIndex = state.sessionOrder.indexOf(targetSessionId);
          if (sourceIndex < 0 || targetIndex < 0) return;
          if (
            (placement === "before" && sourceIndex + 1 === targetIndex) ||
            (placement === "after" && sourceIndex === targetIndex + 1)
          ) {
            return;
          }

          state.sessionOrder.splice(sourceIndex, 1);
          const nextTargetIndex = state.sessionOrder.indexOf(targetSessionId);
          if (nextTargetIndex < 0) return;
          const insertionIndex = placement === "after" ? nextTargetIndex + 1 : nextTargetIndex;
          state.sessionOrder.splice(insertionIndex, 0, sessionId);
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

      markRunCancelling: (sessionId, requestId) =>
        set((state) => {
          const session = state.sessions[sessionId];
          const run = session?.runs.find((entry) => entry.requestId === requestId);
          if (!session || !run || run.status !== "running") return;
          run.status = "cancelling";
          run.revision += 1;
          session.activeRequestId = requestId;
          session.updatedAt = nowIso();
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
          for (const session of Object.values(state.sessions as Record<string, SessionRecord>)) {
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
          const session = (state.sessions as Record<string, SessionRecord>)[batch.sessionId];
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
          for (const session of Object.values(state.sessions as Record<string, SessionRecord>)) {
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
          const ids = [...new Set<string>(sessionIds?.length ? sessionIds : state.sessionOrder)];
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
          const run = (state.sessions as Record<string, SessionRecord>)[sessionId]?.runs.find(
            (item) => item.requestId === requestId,
          );
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
