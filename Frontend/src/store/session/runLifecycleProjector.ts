import {
  EventKinds,
  type RunCancellationProgressData,
  type RunFailedData,
  type RunStartedData,
  type SessionBusyData,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { bumpSessionMessageCount, currentRun, ensureSession, upsertStep } from "./sessionProjectorCore";
import { createRunRecord, touchRun } from "./sessionRunProjection";
import { truncate } from "./sessionPresentation";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import type { RunRecord, StoreState, TimelineStepStatus } from "./types";

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
      run.liveActivity = undefined;
      run.activities = [];
      run.displayMessageId = undefined;
      run.plannedDecisionMode = undefined;
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

  [EventKinds.RunCancellationProgress]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as RunCancellationProgressData;
    const terminal = data.stage === "completed" || data.stage === "failed";
    const component = data.component ? frontendMessage(cancellationComponentMessages[data.component]) : undefined;
    const duration = data.durationMs === undefined ? undefined : `${data.durationMs}ms`;
    upsertStep(run, {
      id: `${run.requestId}-cancellation`,
      kind: "error",
      title: frontendMessage(
        data.stage === "completed"
          ? "run.cancellation.completed"
          : data.stage === "failed"
            ? "run.cancellation.failed"
            : "run.cancellation.started",
      ),
      description: [component, duration, data.message].filter(Boolean).join(" · ") || undefined,
      status: data.stage === "failed" || data.stage === "component_failed" ? "failed" : terminal ? "done" : "running",
      startedAt: env.timestamp,
      endedAt: terminal ? env.timestamp : undefined,
      detailJson: data,
    });
  },

  [EventKinds.RunCompleted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    run.status = "completed";
    settleRunActivities(run, "done", env.timestamp);
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
      delete state.historyActiveRequestIds[sessionId];
      return;
    }
    if (run) {
      run.status = "failed";
      settleRunActivities(run, "failed", env.timestamp);
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
      settleRunActivities(run, "failed", env.timestamp);
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
      settleRunActivities(run, "failed", env.timestamp);
      run.endedAt = env.timestamp;
      run.streamingRaw = "";
      run.xmlPreview = "";
      run.visibleText = "";
      run.displayText = "";
      run.displayMessageId = undefined;
      run.visibleKind = "unknown";
      run.decisionMode = "none";
      run.plannedDecisionMode = undefined;
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

function settleRunActivities(
  run: RunRecord,
  status: Extract<TimelineStepStatus, "done" | "failed">,
  endedAt: string,
): void {
  run.liveActivity = undefined;
  for (const activity of run.activities ?? []) {
    if (activity.status !== "running") continue;
    activity.status = status;
    activity.endedAt = endedAt;
  }
}

const cancellationComponentMessages = {
  agent_loop: "run.cancellation.component.agent_loop",
  pi_session: "run.cancellation.component.pi_session",
} as const;

function hasHistoryTraceRun(state: StoreState, sessionId: string, requestId?: string): boolean {
  if (!requestId) return false;
  return (state.historyStepBuffers[sessionId] ?? []).some((run) => run.requestId === requestId);
}
