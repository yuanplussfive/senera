import {
  EventKinds,
  type EventEnvelope,
  type RunCancellationProgressData,
  type RunCompletedData,
  type RunFailedData,
  type RunStartedData,
  type SessionBusyData,
} from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { resolveBackendMessage } from "../../i18n/backendMessage";
import {
  bumpSessionMessageCount,
  currentRun,
  ensureSession,
  projectSessionChannel,
  upsertStep,
} from "./sessionProjectorCore";
import { createRunRecord, touchRun } from "./sessionRunProjection";
import { truncate } from "./sessionPresentation";
import { upsertMessageByRequestId } from "./historyRunProjection";
import { DEFAULT_SESSION_TITLE } from "./defaults";
import { rejectRunRecovery } from "./runRecoveryProjection";
import { readCurrentRun, type RunEventHandlerMap } from "./runEventProjectionTypes";
import type { RunRecord, SessionRecord, StoreState, TimelineStepStatus } from "./types";

export const runLifecycleEventHandlers = {
  [EventKinds.RunStarted]: (state, env) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const session = ensureSession(state, sessionId);
    projectSessionChannel(session, env.scope?.channel);
    const data = env.data as RunStartedData;
    projectChannelUserMessage(session, env, data);
    projectRecoveryUserMessage(session, env, data);
    let run = currentRun(session, env.requestId);
    if (!run) {
      run = createRunRecord({
        requestId: env.requestId ?? "unknown",
        startedAt: env.timestamp,
        input: data.displayInput ?? data.input,
      });
      session.runs.push(run);
    } else {
      run.status = "running";
      run.outputState = "pending";
      run.liveActivity = undefined;
      run.activities = [];
      run.displayMessageId = undefined;
      run.plannedDecisionMode = undefined;
      run.continuity = undefined;
      run.thinkingBlocks = [];
      run.activeModelRequest = undefined;
    }
    run.recovery = data.recovery;
    if (data.recovery) {
      const source = currentRun(session, data.recovery.sourceRequestId);
      if (source) source.recoveryAttempt = undefined;
    }
    upsertStep(run, {
      id: `${run.requestId}-understand`,
      kind: "understand",
      title: frontendMessage("workflow.projection.understandUser"),
      description: data.internal ? undefined : truncate(data.displayInput ?? data.input, 60),
      status: "done",
      startedAt: env.timestamp,
      endedAt: env.timestamp,
      eventSequence: env.sequence,
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
    if (run.status === "running" && data.stage !== "failed") run.status = "cancelling";
    const component = data.component ? frontendMessage(cancellationComponentMessages[data.component]) : undefined;
    const duration = data.durationMs === undefined ? undefined : `${data.durationMs}ms`;
    const message = resolveBackendMessage(data);
    upsertStep(run, {
      id: `${run.requestId}-cancellation`,
      kind: "error",
      title: frontendMessage(
        data.stage === "completed"
          ? "run.cancellation.completed"
          : data.stage === "failed"
            ? "run.cancellation.failed"
            : data.stage === "settlement_delayed"
              ? "run.cancellation.delayed"
              : "run.cancellation.started",
      ),
      description: [component, duration, message].filter(Boolean).join(" · ") || undefined,
      status: data.stage === "failed" || data.stage === "component_failed" ? "failed" : terminal ? "done" : "running",
      startedAt: env.timestamp,
      endedAt: terminal ? env.timestamp : undefined,
      detailJson: data,
    });
  },

  [EventKinds.RunCompleted]: (state, env) => {
    const run = readCurrentRun(state, env);
    if (!run) return;
    const data = env.data as RunCompletedData;
    if (data.usage !== undefined) run.usage = data.usage;
    run.status = "completed";
    run.outputState = "committed";
    settleRunExecution(run, "done", env.timestamp);
    run.endedAt = env.timestamp;
    touchRun(run);
    const session = state.sessions[env.sessionId ?? ""];
    if (session) {
      clearActiveRequestIfCurrent(session, run.requestId);
      session.updatedAt = env.timestamp;
    }
  },

  [EventKinds.RunFailed]: (state, env) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const session = state.sessions[sessionId];
    if (!session) return;
    const data = env.data as RunFailedData;
    const message = resolveBackendMessage(data) ?? data.message;
    if (rejectRunRecovery(session, env.requestId, message)) return;
    const run = currentRun(session, env.requestId);
    if (!run && state.historyLoadingIds[sessionId]) {
      if (
        (env.requestId && state.historyEventRunIds[sessionId]?.[env.requestId]) ||
        hasHistoryTraceRun(state, sessionId, env.requestId) ||
        isHistoryActiveRequest(state, sessionId, env.requestId)
      ) {
        // A reconnect can deliver the terminal live event before the history
        // replay reaches this run's `run.started` event. Keep the replay
        // alive; its step snapshot will reconstruct the terminal run.
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
      if (state.historyRunEventBuffers) delete state.historyRunEventBuffers[sessionId];
      if (state.historyPreviewedIds) delete state.historyPreviewedIds[sessionId];
      if (state.historyHydration) delete state.historyHydration[sessionId];
      return;
    }
    if (!run) return;
    run.status = "failed";
    run.recoveryModes = data.recoveryModes;
    settleRunExecution(run, "failed", env.timestamp);
    run.endedAt = env.timestamp;
    upsertStep(run, {
      id: `${run.requestId}-error`,
      kind: "error",
      title: frontendMessage("workflow.projection.runFailed"),
      description: message,
      status: "failed",
      startedAt: env.timestamp,
      endedAt: env.timestamp,
      errorMessage: message,
    });
    session.messages.push({
      id: `${env.requestId ?? "run"}-error`,
      role: "system",
      content: message,
      createdAt: env.timestamp,
      kind: "Error",
      requestId: env.requestId,
      failure: data,
    });
    bumpSessionMessageCount(session);
    clearActiveRequestIfCurrent(session, run.requestId);
  },

  [EventKinds.SessionBusy]: (state, env) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const session = state.sessions[sessionId];
    if (!session) return;
    const data = env.data as SessionBusyData;
    const message = resolveBackendMessage(data) ?? data.message;
    const rejectedRequestId = data.rejectedRequestId || env.requestId;
    if (rejectRunRecovery(session, rejectedRequestId, message)) return;
    if (!rejectedRequestId || rejectedRequestId === data.activeRequestId) return;
    const run = session.runs.find((item) => item.requestId === rejectedRequestId);
    if (run) {
      run.status = "failed";
      settleRunExecution(run, "failed", env.timestamp);
      run.endedAt = env.timestamp;
      upsertStep(run, {
        id: `${run.requestId}-busy`,
        kind: "error",
        title: frontendMessage("workflow.projection.runBusy"),
        description: message,
        status: "failed",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
        errorMessage: message,
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
      settleRunExecution(run, "cancelled", env.timestamp);
      run.endedAt = env.timestamp;
      const cancellationStep = run.steps.find((step) => step.id === `${run.requestId}-cancellation`);
      if (cancellationStep) {
        cancellationStep.status = "cancelled";
        cancellationStep.endedAt = env.timestamp;
      }
      upsertStep(run, {
        id: `${run.requestId}-cancelled`,
        kind: "error",
        title: frontendMessage("workflow.projection.cancelled"),
        description: frontendMessage("workflow.projection.cancelledDescription"),
        status: "cancelled",
        startedAt: env.timestamp,
        endedAt: env.timestamp,
      });
      run.activeFlags = undefined;
      touchRun(run);
    }
    if (run && session.activeRequestId === run.requestId) session.activeRequestId = undefined;
    session.updatedAt = env.timestamp;
  },
} satisfies RunEventHandlerMap;

function projectChannelUserMessage(session: SessionRecord, env: EventEnvelope, data: RunStartedData): void {
  const channel = env.scope?.channel;
  if (!channel || channel === "console" || data.internal || !env.requestId || typeof data.input !== "string") return;

  const hadMessages = session.messages.length > 0;
  const inserted = upsertMessageByRequestId(session, {
    id: `${env.requestId}-user`,
    role: "user",
    content: data.input,
    createdAt: env.timestamp,
    requestId: env.requestId,
    ...(data.attachments?.length ? { attachments: data.attachments } : {}),
  });
  if (!inserted) return;

  if (!hadMessages && session.title === DEFAULT_SESSION_TITLE) {
    session.title = truncate(data.input, 24);
  }
  session.messages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  bumpSessionMessageCount(session);
}

function projectRecoveryUserMessage(session: SessionRecord, env: EventEnvelope, data: RunStartedData): void {
  if (data.recovery?.mode !== "continue" || !env.requestId) return;
  const inserted = upsertMessageByRequestId(session, {
    id: `${env.requestId}-user`,
    role: "user",
    content: data.input,
    createdAt: env.timestamp,
    requestId: env.requestId,
    metadata: {
      recovery: data.recovery,
    },
  });
  if (!inserted) return;
  session.messages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  bumpSessionMessageCount(session);
}

function settleRunExecution(
  run: RunRecord,
  status: Extract<TimelineStepStatus, "done" | "failed" | "cancelled">,
  endedAt: string,
): void {
  run.liveActivity = undefined;
  for (const block of run.thinkingBlocks ?? []) {
    if (block.status === "streaming") block.status = "interrupted";
  }
  for (const activity of run.activities ?? []) {
    if (activity.status !== "running" && activity.status !== "cancelling" && activity.status !== "pending") continue;
    activity.status = status;
    activity.endedAt = endedAt;
  }
  for (const step of run.steps) {
    const shouldSettle =
      step.status === "running" ||
      step.status === "cancelling" ||
      (status === "cancelled" && step.status === "pending");
    if (!shouldSettle) continue;
    step.status = status;
    step.endedAt = endedAt;
  }
}

const cancellationComponentMessages = {
  agent_loop: "run.cancellation.component.agent_loop",
  pi_session: "run.cancellation.component.pi_session",
} as const;

function hasHistoryTraceRun(state: StoreState, sessionId: string, requestId?: string): boolean {
  if (!requestId) return false;
  return (state.historyStepBuffers[sessionId] ?? []).some((page) => page.some((run) => run.requestId === requestId));
}

function isHistoryActiveRequest(state: StoreState, sessionId: string, requestId?: string): boolean {
  return Boolean(requestId && state.historyActiveRequestIds[sessionId] === requestId);
}

function clearActiveRequestIfCurrent(session: { activeRequestId?: string }, requestId: string): void {
  if (session.activeRequestId === requestId) session.activeRequestId = undefined;
}
