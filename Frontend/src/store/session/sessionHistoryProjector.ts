import {
  EventKinds,
  type EventEnvelope,
  type SessionHistoryChunkData,
  type SessionHistoryCompletedData,
  type SessionHistoryStartedData,
  type SessionHistoryStepsData,
  type SessionRunHistoryChunkData,
} from "../../api/eventTypes";
import { mergeHistoryMessages, projectEntryToMessage, rebuildRunFromHistory } from "./historyRunProjection";
import { ensureSession, syncSessionCountsFromLoadedMessages, upsertStep } from "./sessionProjectorCore";
import { syncRunActiveFlags, touchRun } from "./sessionRunProjection";
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
    const session = ensureSession(state, sessionId);
    const hasLocalConversation = session.messages.length > 0 || session.runs.length > 0;
    if (!data.refresh && !hasLocalConversation) {
      session.messages = [];
      session.runs = [];
    }
    session.entryCount = data.totalEntries;
    session.messageCount = data.messageCount;
    state.historyReplayBuffers[sessionId] = [];
    state.historyStepBuffers[sessionId] = [];
    state.historyEventRunIds[sessionId] = {};
    state.historyActiveRequestIds[sessionId] = session.activeRequestId ?? null;
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
    ensureSession(state, sessionId);
    const buffer = state.historyReplayBuffers[sessionId];
    if (!state.historyLoadingIds[sessionId] || !buffer) return;
    buffer.push(...data.entries);
  },

  [EventKinds.SessionHistorySteps]: ({ state, env }) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const data = env.data as SessionHistoryStepsData;
    ensureSession(state, sessionId);
    if (!state.historyLoadingIds[sessionId]) return;
    state.historyStepBuffers[sessionId] = data.runs;
  },

  [EventKinds.SessionRunHistoryChunk]: ({ state, env, applyEvent }) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const data = env.data as SessionRunHistoryChunkData;
    if (data.sessionId && data.sessionId !== sessionId) return;
    ensureSession(state, sessionId);
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
    const session = ensureSession(state, sessionId);
    const buffer = state.historyReplayBuffers[sessionId] ?? [];
    const stepRuns = state.historyStepBuffers[sessionId] ?? [];
    const completedRequestIds = new Set(
      stepRuns.filter((run) => run.status === "completed").map((run) => run.requestId),
    );
    const nextMessages = buffer
      .map((item) => projectEntryToMessage(item.entry, item.visible, completedRequestIds))
      .filter((message): message is ChatMessage => Boolean(message));
    const eventRunIds = state.historyEventRunIds[sessionId] ?? {};
    const activeRequestId = state.historyActiveRequestIds[sessionId] ?? undefined;
    if (data.refresh) {
      mergeHistoryMessages(session, nextMessages);
    } else {
      // Run events restore visible intermediate messages; conversation entries restore durable turns.
      // Merge them so a tool preface cannot be erased when history replay completes.
      mergeHistoryMessages(session, nextMessages);
    }
    reconcileHistoryStepRuns(session, stepRuns);
    closeRecoveredRunningRuns(
      session,
      env.timestamp,
      new Set([...stepRuns.map((run) => run.requestId), ...Object.keys(eventRunIds)]),
      activeRequestId,
    );
    clearHistoryLoadingState(state, sessionId);
    state.historyLoadedIds[sessionId] = true;
    syncSessionCountsFromLoadedMessages(session);
  },
};

function reconcileHistoryStepRuns(session: SessionRecord, snapshots: SessionHistoryStepsData["runs"]): void {
  for (const snapshot of snapshots) {
    const recovered = rebuildRunFromHistory(snapshot);
    const existing = session.runs.find((run) => run.requestId === snapshot.requestId);
    if (!existing) {
      session.runs.push(recovered);
      continue;
    }

    existing.input ||= recovered.input;
    existing.startedAt ||= recovered.startedAt;
    existing.modelProvider ??= recovered.modelProvider;
    existing.endedAt = recovered.endedAt ?? existing.endedAt;

    // The run snapshot is the durable lifecycle authority. A stale running
    // snapshot must not downgrade a terminal live event observed meanwhile.
    if (recovered.status !== "running" || existing.status === "running") {
      existing.status = recovered.status;
    }
    if (existing.status !== "running") {
      existing.recoverySource = undefined;
    }

    const existingStepIds = new Set(existing.steps.map((step) => step.id));
    for (const step of recovered.steps) {
      if (!existingStepIds.has(step.id)) {
        existing.steps.push(step);
      }
    }
    touchRun(existing);
  }
  session.runs.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function clearHistoryLoadingState(state: StoreState, sessionId: string): void {
  state.historyLoadingIds[sessionId] = false;
  delete state.historyReplayBuffers[sessionId];
  delete state.historyStepBuffers[sessionId];
  delete state.historyEventRunIds[sessionId];
  delete state.historyActiveRequestIds[sessionId];
  delete state.historyFailedIds[sessionId];
  delete state.missingOnServerIds[sessionId];
}

function closeRecoveredRunningRuns(
  session: SessionRecord,
  timestamp: string,
  recoveredRunIds: ReadonlySet<string>,
  activeRequestId: string | undefined,
): void {
  for (const run of session.runs) {
    if (run.status !== "running" || !recoveredRunIds.has(run.requestId) || run.requestId === activeRequestId) {
      continue;
    }

    run.status = "cancelled";
    run.endedAt = timestamp;
    run.recoverySource = "history";
    settleInterruptedRunWaits(run, timestamp);
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

  session.activeRequestId = activeRequestId;
}

function settleInterruptedRunWaits(run: SessionRecord["runs"][number], timestamp: string): void {
  const message = frontendMessage("workflow.projection.historyInterruptedDescription");

  for (const approval of run.approvals ?? []) {
    if (approval.status !== "pending") continue;
    approval.status = "cancelled";
    approval.resolvedAt = timestamp;
    approval.message = message;
    approval.disposition = "interrupt";
    approval.resolutionPending = false;
    approval.pendingDecision = undefined;
    settlePendingStep(run, `approval-${approval.approvalId}`, timestamp, message);
  }

  for (const interaction of run.interactionInputs ?? []) {
    if (interaction.status === "resolved") continue;
    interaction.status = "resolved";
    interaction.action = "cancel";
    interaction.resolvedAt = timestamp;
    interaction.resolutionMessage = message;
    interaction.resolutionPending = false;
    interaction.pendingAction = undefined;
    settlePendingStep(run, `interaction-input-${interaction.interactionId}`, timestamp, message);
  }

  syncRunActiveFlags(run);
  touchRun(run);
}

function settlePendingStep(
  run: SessionRecord["runs"][number],
  stepId: string,
  timestamp: string,
  description: string,
): void {
  const step = run.steps.find((entry) => entry.id === stepId);
  if (!step || step.status !== "pending") return;
  step.status = "failed";
  step.endedAt = timestamp;
  step.description = description;
}
