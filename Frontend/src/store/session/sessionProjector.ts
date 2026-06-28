import { DEFAULT_SESSION_TITLE } from "./defaults";
import { normalizeUserProfile } from "./userProfile";
import {
  EventKinds,
  type EventEnvelope,
  type ConfigSnapshotData,
  type ModelListSnapshotData,
  type PresetSnapshotData,
  type ProviderModelsFailedData,
  type ProviderModelsSnapshotData,
  type PluginConfigSnapshotData,
  type SessionListSnapshotData,
  type SessionNotFoundData,
  type SessionSnapshotData,
  type SessionTruncatedData,
  type UserProfileData,
} from "../../api/eventTypes";
import { projectRunEvent } from "./runEventProjector";
import { applyScopedRunEvent } from "./scopedRunProjector";
import { projectSessionHistoryEvent } from "./sessionHistoryProjector";
import {
  ingestSessionList,
  readFirstAvailableSessionId,
} from "./sessionListProjection";
import {
  nowIso,
  syncSessionCountsFromLoadedMessages,
} from "./sessionProjectorCore";
import { readChatModelProviders } from "../../features/chat/modelProvider";
import type { StoreState } from "./types";

export { normalizeUserProfile } from "./userProfile";
export { friendlyDecisionKind, truncate } from "./sessionPresentation";
export { advanceRunDisplayText, createRunRecord } from "./sessionRunProjection";
export { bumpSessionMessageCount } from "./sessionProjectorCore";
export { deleteSessionRuntimeState } from "./sessionListProjection";

// =========================
// reducer：把 36 种事件投影到状态
// =========================

export function applyEvent(state: StoreState, env: EventEnvelope): void {
  const sessionId = env.sessionId;

  if (
    sessionId &&
    state.pendingDeletedSessionIds[sessionId] &&
    !isPendingDeleteResolutionEvent(env.kind)
  ) {
    return;
  }

  if (applyScopedRunEvent(state, env)) {
    return;
  }

  if (projectSessionHistoryEvent({ state, env, applyEvent })) {
    return;
  }

  if (projectRunEvent(state, env)) {
    return;
  }

  switch (env.kind) {
    case EventKinds.ModelListSnapshot: {
      const data = env.data as ModelListSnapshotData;
      state.modelProviders = data.models;
      const chatModels = readChatModelProviders(data.models);
      const selectedId = state.selectedModelProviderId;
      const selectedStillExists = selectedId
        ? chatModels.some((model) => model.id === selectedId)
        : false;
      const defaultChatModel = chatModels.find((model) => model.id === data.defaultModelProviderId)
        ?? chatModels.find((model) => model.isDefault)
        ?? chatModels[0];
      state.selectedModelProviderId = selectedStillExists
        ? selectedId
        : defaultChatModel?.id ?? null;
      return;
    }

    case EventKinds.ProviderModelsSnapshot: {
      const data = env.data as ProviderModelsSnapshotData;
      state.providerModelCatalogs[data.providerId] = data;
      delete state.providerModelErrors[data.providerId];
      return;
    }

    case EventKinds.ProviderModelsFailed: {
      const data = env.data as ProviderModelsFailedData;
      state.providerModelErrors[data.providerId] = {
        ...data,
        updatedAt: env.timestamp,
      };
      return;
    }

    case EventKinds.ConfigSnapshot: {
      state.configSnapshot = env.data as ConfigSnapshotData;
      return;
    }

    case EventKinds.ProfileSnapshot: {
      if (state.userProfile.syncState === "pending") return;
      state.userProfile = normalizeUserProfile(env.data as UserProfileData);
      return;
    }

    case EventKinds.PluginConfigSnapshot: {
      const data = env.data as PluginConfigSnapshotData;
      state.pluginConfigs = data.plugins;
      return;
    }

    case EventKinds.PresetSnapshot: {
      const data = env.data as PresetSnapshotData;
      state.presets = data.presets;
      state.activePresetName = data.activePresetName;
      state.presetsEnabled = data.enabled;
      state.presetRootDir = data.rootDir;
      return;
    }

    case EventKinds.SessionCreated:
    case EventKinds.SessionSnapshot: {
      if (!sessionId) return;
      const data = env.data as SessionSnapshotData;
      delete state.pendingCreatedSessionIds[sessionId];
      if (state.pendingDeletedSessionIds[sessionId]) return;
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
      if (!sessionId) return;
      delete state.pendingDeletedSessionIds[sessionId];
      delete state.pendingCreatedSessionIds[sessionId];
      if (!state.sessions[sessionId]) return;
      delete state.sessions[sessionId];
      state.sessionOrder = state.sessionOrder.filter((id) => id !== sessionId);
      delete state.historyLoadedIds[sessionId];
      delete state.historyLoadingIds[sessionId];
      delete state.viewedRunIdBySession[sessionId];
      delete state.missingOnServerIds[sessionId];
      delete state.historyEventRunIds[sessionId];
      if (state.activeSessionId === sessionId) {
        state.activeSessionId = state.sessionOrder[0] ?? null;
      }
      if (state.activeSessionId && !state.sessions[state.activeSessionId]) {
        state.activeSessionId = state.sessionOrder[0] ?? null;
      }
      return;
    }

    case EventKinds.SessionListSnapshot: {
      const data = env.data as SessionListSnapshotData;
      ingestSessionList(state, data.sessions);
      return;
    }

    case EventKinds.SessionNotFound: {
      if (!sessionId) return;
      const data = env.data as SessionNotFoundData;
      state.historyLoadingIds[sessionId] = false;
      delete state.historyReplayBuffers[sessionId];
      delete state.historyStepBuffers[sessionId];
      delete state.historyEventRunIds[sessionId];
      delete state.historyFailedIds[sessionId];
      if (data.operation === "session.close") {
        delete state.pendingDeletedSessionIds[sessionId];
        delete state.pendingCreatedSessionIds[sessionId];
        delete state.sessions[sessionId];
        state.sessionOrder = state.sessionOrder.filter((id) => id !== sessionId);
        if (state.activeSessionId === sessionId) {
          state.activeSessionId = state.sessionOrder[0] ?? null;
        }
        return;
      }
      if (data.operation === "session.history") {
        state.missingOnServerIds[sessionId] = true;
        delete state.historyLoadedIds[sessionId];
        if (state.sessions[sessionId]) {
          state.sessions[sessionId].messages = [];
          state.sessions[sessionId].runs = [];
          state.sessions[sessionId].entryCount = 0;
          state.sessions[sessionId].messageCount = 0;
        }
        if (state.activeSessionId === sessionId) {
          state.activeSessionId = readFirstAvailableSessionId(state, sessionId);
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

function isPendingDeleteResolutionEvent(kind: string): boolean {
  return kind === EventKinds.SessionClosed || kind === EventKinds.SessionNotFound;
}
