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
  type SessionForkedData,
  type SessionNotFoundData,
  type SessionSnapshotData,
  type SessionTruncatedData,
  type UserProfileData,
  type RequestInvalidData,
} from "../../api/eventTypes";
import { projectRunEvent } from "./runEventProjector";
import { applyScopedRunEvent } from "./scopedRunProjector";
import { projectSessionHistoryEvent } from "./sessionHistoryProjector";
import {
  deleteSessionRuntimeState,
  ingestSessionList,
  readFirstAvailableSessionId,
} from "./sessionListProjection";
import { nowIso, syncSessionCountsFromLoadedMessages } from "./sessionProjectorCore";
import { applyModelListSnapshotSelection, syncActiveSessionModelSelection } from "./sessionModelSelection";
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

  if (sessionId && state.pendingDeletedSessionIds[sessionId] && !isPendingDeleteResolutionEvent(env.kind)) {
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
    case EventKinds.RequestInvalid: {
      const details = (env.data as RequestInvalidData).details;
      const interactionId =
        details && typeof details === "object" && "interactionId" in details
          ? (details as { interactionId?: unknown }).interactionId
          : undefined;
      if (typeof interactionId !== "string") return;
      for (const session of Object.values(state.sessions)) {
        for (const run of session.runs) {
          const interaction = run.interactionInputs?.find((entry) => entry.interactionId === interactionId);
          if (!interaction) continue;
          interaction.resolutionPending = false;
          interaction.pendingAction = undefined;
          run.revision += 1;
          return;
        }
      }
      return;
    }
    case EventKinds.ModelListSnapshot: {
      applyModelListSnapshotSelection(state, env.data as ModelListSnapshotData);
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
        if (state.historyLoadingIds[sessionId]) {
          state.historyActiveRequestIds[sessionId] = data.activeRequestId ?? null;
        }
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
      delete state.selectedModelProviderIdsBySession[sessionId];
      state.sessionOrder = state.sessionOrder.filter((id) => id !== sessionId);
      delete state.historyLoadedIds[sessionId];
      delete state.historyLoadingIds[sessionId];
      delete state.viewedRunIdBySession[sessionId];
      delete state.missingOnServerIds[sessionId];
      delete state.historyEventRunIds[sessionId];
      delete state.historyActiveRequestIds[sessionId];
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

    case EventKinds.SessionForked: {
      if (!sessionId) return;
      const data = env.data as SessionForkedData;
      const session = state.sessions[sessionId];
      if (!session) return;
      session.title = data.title || session.title;
      session.createdAt = data.createdAt || session.createdAt;
      session.updatedAt = env.timestamp;
      session.forkOrigin = {
        sourceSessionId: data.sourceSessionId,
        throughRequestId: data.throughRequestId,
      };
      const sourceModelProviderId = state.selectedModelProviderIdsBySession[data.sourceSessionId];
      if (sourceModelProviderId) {
        state.selectedModelProviderIdsBySession[sessionId] = sourceModelProviderId;
      }
      state.activeSessionId = sessionId;
      syncActiveSessionModelSelection(state);
      return;
    }

    case EventKinds.SessionNotFound: {
      if (!sessionId) return;
      projectSessionNotFound(state, sessionId, env.data as SessionNotFoundData);
      return;
    }

    case EventKinds.SessionTruncated: {
      if (!sessionId) return;
      const data = env.data as SessionTruncatedData;
      truncateSessionFromRequest(state, sessionId, data.fromRequestId, env.timestamp, {
        retainedRequestId: data.replacementRequestId,
      });
      return;
    }

    default:
      return;
  }
}

const SessionNotFoundProjectionPolicies = {
  "session.close": "remove",
  "session.history": "mark_missing",
  "session.message": "mark_missing",
  "session.fork": "mark_missing",
} as const satisfies Record<SessionNotFoundData["operation"], "remove" | "mark_missing">;

function projectSessionNotFound(state: StoreState, sessionId: string, data: SessionNotFoundData): void {
  clearSessionRecoveryState(state, sessionId);
  switch (SessionNotFoundProjectionPolicies[data.operation]) {
    case "remove":
      delete state.pendingDeletedSessionIds[sessionId];
      delete state.pendingCreatedSessionIds[sessionId];
      deleteSessionRuntimeState(state, sessionId);
      if (state.activeSessionId === sessionId) state.activeSessionId = readFirstAvailableSessionId(state);
      return;
    case "mark_missing":
      delete state.pendingCreatedSessionIds[sessionId];
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
}

function clearSessionRecoveryState(state: StoreState, sessionId: string): void {
  state.historyLoadingIds[sessionId] = false;
  delete state.historyReplayBuffers[sessionId];
  delete state.historyStepBuffers[sessionId];
  delete state.historyEventRunIds[sessionId];
  delete state.historyActiveRequestIds[sessionId];
  delete state.historyFailedIds[sessionId];
}

export function truncateSessionFromRequest(
  state: StoreState,
  sessionId: string,
  fromRequestId: string,
  timestamp = nowIso(),
  options: { retainedRequestId?: string } = {},
): void {
  const session = state.sessions[sessionId];
  if (!session) return;
  const retainedMessages = options.retainedRequestId
    ? session.messages.filter((message) => message.requestId === options.retainedRequestId)
    : [];
  const retainedRuns = options.retainedRequestId
    ? session.runs.filter((run) => run.requestId === options.retainedRequestId)
    : [];
  const messageIndex = session.messages.findIndex((message) => message.requestId === fromRequestId);
  if (messageIndex >= 0) {
    session.messages = appendMissingByKey(
      session.messages.slice(0, messageIndex),
      retainedMessages,
      (message) => message.id,
    );
    syncSessionCountsFromLoadedMessages(session);
  }
  const runIndex = session.runs.findIndex((run) => run.requestId === fromRequestId);
  if (runIndex >= 0) {
    session.runs = appendMissingByKey(session.runs.slice(0, runIndex), retainedRuns, (run) => run.requestId);
  }
  if (
    session.activeRequestId &&
    !session.runs.some((run) => run.requestId === session.activeRequestId) &&
    !session.messages.some((message) => message.requestId === session.activeRequestId)
  ) {
    session.activeRequestId = undefined;
  }
  const viewedRunId = state.viewedRunIdBySession[sessionId];
  if (viewedRunId && !session.runs.some((run) => run.requestId === viewedRunId)) {
    delete state.viewedRunIdBySession[sessionId];
  }
  session.updatedAt = timestamp;
}

function appendMissingByKey<T>(current: T[], retained: readonly T[], selectKey: (item: T) => string): T[] {
  if (retained.length === 0) return current;
  const currentKeys = new Set(current.map(selectKey));
  return [...current, ...retained.filter((item) => !currentKeys.has(selectKey(item)))];
}

function isPendingDeleteResolutionEvent(kind: string): boolean {
  return kind === EventKinds.SessionClosed || kind === EventKinds.SessionNotFound;
}
