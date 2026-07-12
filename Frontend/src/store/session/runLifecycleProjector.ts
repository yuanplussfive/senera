import { EventKinds, type RunFailedData, type RunStartedData, type SessionBusyData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { bumpSessionMessageCount, currentRun, ensureSession, upsertStep } from "./sessionProjectorCore";
import { createRunRecord, touchRun } from "./sessionRunProjection";
import { truncate } from "./sessionPresentation";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import type { StoreState } from "./types";

export const runLifecycleEventHandlers = {
  [EventKinds.RunStarted]: (state, env) => {
    const sessionId = env.sessionId;
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
      title: frontendMessage("workflow.projection.understandUser"),
      description: truncate(data.input, 60),
      status: "done",
      startedAt: env.timestamp,
      endedAt: env.timestamp,
    });
    session.activeRequestId = run.requestId;
    session.updatedAt = env.timestamp;
    delete state.viewedRunIdBySession[sessionId];
  },

  [EventKinds.RunCompleted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    run.status = "completed";
    run.endedAt = env.timestamp;
    touchRun(run);
    const session = state.sessions[env.sessionId ?? ""];
    if (session) {
      session.activeRequestId = undefined;
      session.updatedAt = env.timestamp;
    }
  },

  [EventKinds.RunFailed]: (state, env) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const session = ensureSession(state, sessionId);
    const data = env.data as RunFailedData;
    const run = currentRun(session, env.requestId);
    if (!run && state.historyLoadingIds[sessionId]) {
      if (
        (env.requestId && state.historyEventRunIds[sessionId]?.[env.requestId]) ||
        hasHistoryTraceRun(state, sessionId, env.requestId)
      ) {
        return;
      }
      session.messages = [];
      session.runs = [];
      state.historyLoadingIds[sessionId] = false;
      state.historyFailedIds[sessionId] = true;
      delete state.historyReplayBuffers[sessionId];
      delete state.historyStepBuffers[sessionId];
      delete state.historyEventRunIds[sessionId];
      return;
    }
    if (run) {
      run.status = "failed";
      run.endedAt = env.timestamp;
      upsertStep(run, {
        id: `${run.requestId}-error`,
        kind: "error",
        title: frontendMessage("workflow.projection.runFailed"),
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
  },

  [EventKinds.SessionBusy]: (state, env) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const session = state.sessions[sessionId];
    if (!session) return;
    const data = env.data as SessionBusyData;
    const rejectedRequestId = data.rejectedRequestId || env.requestId;
    if (!rejectedRequestId || rejectedRequestId === data.activeRequestId) return;
    const run = session.runs.find((item) => item.requestId === rejectedRequestId);
    if (run) {
      run.status = "failed";
      run.endedAt = env.timestamp;
      upsertStep(run, {
        id: `${run.requestId}-busy`,
        kind: "error",
        title: frontendMessage("workflow.projection.runBusy"),
        description: data.message,
        status: "failed",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        errorMessage: data.message,
      });
    }
    if (session.activeRequestId === rejectedRequestId) {
      session.activeRequestId = data.activeRequestId || undefined;
    }
  },

  [EventKinds.RunCancelled]: (state, env) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const session = ensureSession(state, sessionId);
    const run = currentRun(session, env.requestId);
    if (run) {
      run.status = "cancelled";
      run.endedAt = env.timestamp;
      run.streamingRaw = "";
      run.xmlPreview = "";
      run.visibleText = "";
      run.displayText = "";
      run.visibleKind = "unknown";
      run.decisionMode = "none";
      upsertStep(run, {
        id: `${run.requestId}-cancelled`,
        kind: "error",
        title: frontendMessage("workflow.projection.cancelled"),
        description: frontendMessage("workflow.projection.cancelledDescription"),
        status: "failed",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
      });
    }
    session.activeRequestId = undefined;
    session.updatedAt = env.timestamp;
  },
} satisfies RunEventHandlerMap;

function hasHistoryTraceRun(state: StoreState, sessionId: string, requestId?: string): boolean {
  if (!requestId) return false;
  return (state.historyStepBuffers[sessionId] ?? []).some((run) => run.requestId === requestId);
}
