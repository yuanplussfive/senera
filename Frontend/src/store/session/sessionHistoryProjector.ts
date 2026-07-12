import {
  EventKinds,
  type EventEnvelope,
  type SessionHistoryChunkData,
  type SessionHistoryCompletedData,
  type SessionHistoryStartedData,
  type SessionHistoryStepsData,
  type SessionRunHistoryChunkData,
} from "../../api/eventTypes";
import {
  mergeHistoryMessages,
  mergeHistoryRuns,
  projectEntryToMessage,
  rebuildRunFromHistory,
} from "./historyRunProjection";
import { syncSessionCountsFromLoadedMessages, upsertStep } from "./sessionProjectorCore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { ChatMessage, SessionRecord, StoreState } from "./types";

export type SessionHistoryProjectionContext = {
  state: StoreState;
  env: EventEnvelope;
  applyEvent: (state: StoreState, env: EventEnvelope) => void;
};

export function projectSessionHistoryEvent(context: SessionHistoryProjectionContext): boolean {
  const handler = sessionHistoryEventHandlers[context.env.kind];
  if (!handler) return false;
  handler(context);
  return true;
}

type SessionHistoryEventHandler = (context: SessionHistoryProjectionContext) => void;

const sessionHistoryEventHandlers: Partial<Record<EventEnvelope["kind"], SessionHistoryEventHandler>> = {
  [EventKinds.SessionHistoryStarted]: ({ state, env }) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const data = env.data as SessionHistoryStartedData;
    const session = state.sessions[sessionId];
    if (!session) return;
    if (!data.refresh) {
      session.messages = [];
      session.runs = [];
    }
    session.entryCount = data.totalEntries;
    session.messageCount = data.messageCount;
    state.historyReplayBuffers[sessionId] = [];
    state.historyStepBuffers[sessionId] = [];
    state.historyEventRunIds[sessionId] = {};
    state.historyLoadingIds[sessionId] = true;
    if (!data.refresh) {
      delete state.historyLoadedIds[sessionId];
    }
    delete state.historyFailedIds[sessionId];
    delete state.missingOnServerIds[sessionId];
  },

  [EventKinds.SessionHistoryChunk]: ({ state, env }) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const data = env.data as SessionHistoryChunkData;
    if (!state.sessions[sessionId]) return;
    const buffer = state.historyReplayBuffers[sessionId];
    if (!state.historyLoadingIds[sessionId] || !buffer) return;
    buffer.push(...data.entries);
  },

  [EventKinds.SessionHistorySteps]: ({ state, env }) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const data = env.data as SessionHistoryStepsData;
    if (!state.sessions[sessionId]) return;
    if (!state.historyLoadingIds[sessionId]) return;
    state.historyStepBuffers[sessionId] = data.runs;
  },

  [EventKinds.SessionRunHistoryChunk]: ({ state, env, applyEvent }) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const data = env.data as SessionRunHistoryChunkData;
    if (data.sessionId && data.sessionId !== sessionId) return;
    if (!state.sessions[sessionId]) return;
    if (!state.historyLoadingIds[sessionId]) return;
    const eventRunIds = state.historyEventRunIds[sessionId] ?? {};
    state.historyEventRunIds[sessionId] = eventRunIds;
    for (const event of data.events) {
      if (event.kind === EventKinds.RunStarted && event.requestId) {
        eventRunIds[event.requestId] = true;
      }
      const restoredRequestId = event.scope?.parentRequestId ?? event.requestId;
      if (restoredRequestId && !eventRunIds[restoredRequestId]) continue;
      applyEvent(state, {
        ...event,
        sessionId: event.sessionId ?? sessionId,
      });
    }
  },

  [EventKinds.SessionHistoryCompleted]: ({ state, env }) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const data = env.data as SessionHistoryCompletedData;
    if (data.sessionId && data.sessionId !== sessionId) return;
    if (!state.historyLoadingIds[sessionId]) return;
    const session = state.sessions[sessionId];
    if (!session) return;
    const buffer = state.historyReplayBuffers[sessionId] ?? [];
    const nextMessages = buffer
      .map((item) => projectEntryToMessage(item.entry, item.visible))
      .filter((message): message is ChatMessage => Boolean(message));
    const stepRuns = state.historyStepBuffers[sessionId] ?? [];
    const eventRunIds = state.historyEventRunIds[sessionId] ?? {};
    const traceOnlyRuns = stepRuns.filter((run) => !eventRunIds[run.requestId]);
    const hasTraceOnlyRuns = traceOnlyRuns.length > 0;
    const nextRuns = hasTraceOnlyRuns ? traceOnlyRuns.map((run) => rebuildRunFromHistory(run)) : session.runs;
    if (data.refresh) {
      mergeHistoryMessages(session, nextMessages);
      if (hasTraceOnlyRuns) {
        mergeHistoryRuns(session, nextRuns);
      }
    } else {
      // Run events restore visible intermediate messages; conversation entries restore durable turns.
      // Merge them so a tool preface cannot be erased when history replay completes.
      mergeHistoryMessages(session, nextMessages);
      session.runs = nextRuns;
    }
    closeRecoveredRunningRuns(
      session,
      env.timestamp,
      new Set([...stepRuns.map((run) => run.requestId), ...Object.keys(eventRunIds)]),
    );
    clearHistoryLoadingState(state, sessionId);
    state.historyLoadedIds[sessionId] = true;
    syncSessionCountsFromLoadedMessages(session);
  },
};

function clearHistoryLoadingState(state: StoreState, sessionId: string): void {
  state.historyLoadingIds[sessionId] = false;
  delete state.historyReplayBuffers[sessionId];
  delete state.historyStepBuffers[sessionId];
  delete state.historyEventRunIds[sessionId];
  delete state.historyFailedIds[sessionId];
  delete state.missingOnServerIds[sessionId];
}

function closeRecoveredRunningRuns(
  session: SessionRecord,
  timestamp: string,
  recoveredRunIds: ReadonlySet<string>,
): void {
  for (const run of session.runs) {
    if (run.status !== "running" || !recoveredRunIds.has(run.requestId)) {
      continue;
    }

    run.status = "cancelled";
    run.endedAt = timestamp;
    run.recoverySource = "history";
    upsertStep(run, {
      id: `${run.requestId}-history-interrupted`,
      kind: "error",
      title: frontendMessage("workflow.projection.historyInterrupted"),
      description: frontendMessage("workflow.projection.historyInterruptedDescription"),
      status: "failed",
      startedAt: timestamp,
      endedAt: timestamp,
    });
  }

  if (session.activeRequestId && recoveredRunIds.has(session.activeRequestId)) {
    session.activeRequestId = undefined;
  }
}
