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
import { mergeToolResultPresentation } from "./toolResultPresentation";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { ChatMessage, SessionRecord, StoreState, TimelineStep } from "./types";

export type SessionHistoryProjectionContext = {
  state: StoreState;
  env: EventEnvelope;
  applyEvent: (state: StoreState, env: EventEnvelope) => boolean;
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
    const buffer = state.historyStepBuffers[sessionId] ?? [];
    buffer.push(...data.runs);
    state.historyStepBuffers[sessionId] = buffer;
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
      const activeStream = captureActiveStream(state, sessionId, restoredRequestId);
      const projected = applyEvent(state, {
        ...event,
        sessionId: event.sessionId ?? sessionId,
      });
      if (projected && activeStream) restoreActiveStream(state, sessionId, activeStream);
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
    // Run events restore live progress messages and execution details; conversation entries restore durable turns.
    mergeHistoryMessages(session, nextMessages);
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

type ActiveStreamSnapshot = Pick<
  SessionRecord["runs"][number],
  | "requestId"
  | "status"
  | "endedAt"
  | "recoverySource"
  | "liveActivity"
  | "activities"
  | "activeFlags"
  | "streamingRaw"
  | "xmlPreview"
  | "visibleText"
  | "displayText"
  | "displayMessageId"
  | "visibleKind"
  | "expectedOutputMode"
  | "decisionMode"
  | "plannedDecisionMode"
  | "modelProvider"
  | "continuity"
>;

function captureActiveStream(
  state: StoreState,
  sessionId: string,
  restoredRequestId: string | undefined,
): ActiveStreamSnapshot | undefined {
  const activeRequestId = state.historyActiveRequestIds[sessionId] ?? undefined;
  if (!activeRequestId || restoredRequestId !== activeRequestId) return undefined;
  const run = state.sessions[sessionId]?.runs.find((entry) => entry.requestId === activeRequestId);
  if (
    !run ||
    run.status !== "running" ||
    !(run.streamingRaw || run.visibleText || run.displayText || run.displayMessageId || run.continuity)
  ) {
    return undefined;
  }
  return {
    requestId: run.requestId,
    status: run.status,
    endedAt: run.endedAt,
    recoverySource: run.recoverySource,
    liveActivity: run.liveActivity,
    activities: run.activities?.map((activity) => ({ ...activity })),
    activeFlags: run.activeFlags ? [...run.activeFlags] : undefined,
    streamingRaw: run.streamingRaw,
    xmlPreview: run.xmlPreview,
    visibleText: run.visibleText,
    displayText: run.displayText,
    displayMessageId: run.displayMessageId,
    visibleKind: run.visibleKind,
    expectedOutputMode: run.expectedOutputMode,
    decisionMode: run.decisionMode,
    plannedDecisionMode: run.plannedDecisionMode,
    modelProvider: run.modelProvider,
    continuity: run.continuity,
  };
}

function restoreActiveStream(state: StoreState, sessionId: string, snapshot: ActiveStreamSnapshot): void {
  const session = state.sessions[sessionId];
  const run = session?.runs.find((entry) => entry.requestId === snapshot.requestId);
  if (!session || !run) return;
  Object.assign(run, snapshot);
  session.activeRequestId = snapshot.requestId;
}

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

    const existingSteps = new Map(existing.steps.map((step) => [step.id, step]));
    for (const recoveredStep of recovered.steps) {
      const existingStep = existingSteps.get(recoveredStep.id);
      if (!existingStep) {
        existing.steps.push(recoveredStep);
        existingSteps.set(recoveredStep.id, recoveredStep);
        continue;
      }
      enrichStepFromHistory(existingStep, recoveredStep);
    }
    touchRun(existing);
  }
  session.runs.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

/**
 * Run-event replay intentionally excludes raw result-detail payloads. The
 * bounded step trace is their durable source, so enrich an event-built step
 * instead of replacing it and losing live output, timing, or progress.
 */
function enrichStepFromHistory(existing: TimelineStep, recovered: TimelineStep): void {
  if (existing.status === "pending" || existing.status === "running") {
    existing.status = recovered.status;
  }

  const existingFields = existing as Record<HistoryStepFallbackField, unknown>;
  const recoveredFields = recovered as Readonly<Record<HistoryStepFallbackField, unknown>>;
  for (const field of HistoryStepFallbackFields) {
    const recoveredValue = recoveredFields[field];
    if (existingFields[field] === undefined && recoveredValue !== undefined) {
      existingFields[field] = recoveredValue;
    }
  }

  const presentation = mergeToolResultPresentation(recovered.toolPresentation, existing.toolPresentation);
  if (presentation) existing.toolPresentation = presentation;
  if (existing.toolPreview === undefined && presentation?.headline) {
    existing.toolPreview = presentation.headline;
  }
}

const HistoryStepFallbackFields = [
  "description",
  "endedAt",
  "durationMs",
  "toolName",
  "toolOrigin",
  "callId",
  "toolBatch",
  "purpose",
  "toolArgs",
  "toolPreview",
  "toolResult",
  "toolErrorMessage",
  "retryCode",
  "errorMessage",
  "decisionKind",
] as const satisfies readonly (keyof TimelineStep)[];

type HistoryStepFallbackField = (typeof HistoryStepFallbackFields)[number];

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
    const isOrphanedAfterReconnect = activeRequestId === undefined;
    const isRecoveredRun = recoveredRunIds.has(run.requestId);
    if (
      run.status !== "running" ||
      run.requestId === activeRequestId ||
      (!isOrphanedAfterReconnect && !isRecoveredRun)
    ) {
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
