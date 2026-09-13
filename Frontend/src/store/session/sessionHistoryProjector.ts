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
import type {
  ChatMessage,
  HistoryActiveStreamSnapshot,
  HistoryHydrationProgress,
  SessionRecord,
  StoreState,
  TimelineStep,
} from "./types";

/** Keep long replay work off the first interactive frame. */
export const HistoryHydrationPolicy = Object.freeze({
  maxSynchronousItems: 512,
  maxItemsPerSlice: 240,
});

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
    const runEventBuffers = (state.historyRunEventBuffers ??= {});
    runEventBuffers[sessionId] = [];
    const previewedIds = (state.historyPreviewedIds ??= {});
    delete previewedIds[sessionId];
    if (state.historyHydration) delete state.historyHydration[sessionId];
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
    if (data.preview) {
      if (!state.historyLoadingIds[sessionId] || data.entries.length === 0) return;
      const previewedIds = (state.historyPreviewedIds ??= {});
      previewedIds[sessionId] = true;
      const previewCompletedRequestIds = new Set(
        data.entries
          .filter(
            ({ entry }) =>
              entry.kind === "assistant.decision" &&
              (Boolean(entry.metadata?.run) || Boolean(entry.metadata?.scheduledTask)),
          )
          .map(({ entry }) => entry.requestId),
      );
      const previewMessages = data.entries
        .map(({ entry, visible }) => projectEntryToMessage(entry, visible, previewCompletedRequestIds))
        .filter((message): message is ChatMessage => Boolean(message));
      mergeHistoryMessages(state.sessions[sessionId], previewMessages);
      return;
    }
    const pages = state.historyReplayBuffers[sessionId];
    if (!state.historyLoadingIds[sessionId] || !pages || data.entries.length === 0) return;
    pages.push([...data.entries]);
  },

  [EventKinds.SessionHistorySteps]: ({ state, env }) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const data = env.data as SessionHistoryStepsData;
    ensureSession(state, sessionId);
    if (!state.historyLoadingIds[sessionId]) return;
    const pages = state.historyStepBuffers[sessionId] ?? [];
    if (data.runs.length > 0) pages.push([...data.runs]);
    state.historyStepBuffers[sessionId] = pages;
  },

  [EventKinds.SessionRunHistoryChunk]: ({ state, env }) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const data = env.data as SessionRunHistoryChunkData;
    if (data.sessionId && data.sessionId !== sessionId) return;
    ensureSession(state, sessionId);
    if (!state.historyLoadingIds[sessionId]) return;
    const eventRunIds = state.historyEventRunIds[sessionId] ?? {};
    state.historyEventRunIds[sessionId] = eventRunIds;
    const runEventBuffers = (state.historyRunEventBuffers ??= {});
    const eventPages = runEventBuffers[sessionId] ?? [];
    runEventBuffers[sessionId] = eventPages;
    const page: EventEnvelope[] = [];
    for (const event of data.events) {
      if (event.kind === EventKinds.RunStarted && event.requestId) {
        eventRunIds[event.requestId] = true;
      }
      const restoredRequestId = event.scope?.parentRequestId ?? event.requestId;
      if (restoredRequestId && !eventRunIds[restoredRequestId]) continue;
      page.push({
        ...event,
        sessionId: event.sessionId ?? sessionId,
      });
    }
    if (page.length > 0) eventPages.push(page);
  },

  [EventKinds.SessionHistoryCompleted]: ({ state, env, applyEvent }) => {
    const sessionId = env.sessionId;
    if (!sessionId) return;
    const data = env.data as SessionHistoryCompletedData;
    if (data.sessionId && data.sessionId !== sessionId) return;
    if (!state.historyLoadingIds[sessionId]) return;
    ensureSession(state, sessionId);
    const progress = createHistoryHydrationProgress(state, sessionId, env.timestamp);
    if (historyWorkSize(state, sessionId) > HistoryHydrationPolicy.maxSynchronousItems) {
      const hydration = (state.historyHydration ??= {});
      hydration[sessionId] = progress;
      // The wire replay is complete, so the composer can be used while the
      // remaining pages are projected during idle time.
      state.historyLoadingIds[sessionId] = false;
      return;
    }

    while (advanceSessionHistoryHydration(state, sessionId, applyEvent, progress, Number.MAX_SAFE_INTEGER)) {
      // Small histories use the same reconciliation path as large histories;
      // the only difference is that this loop is allowed to finish inline.
    }
  },
};

/**
 * Drain one history replay in bounded work slices. The caller owns scheduling;
 * keeping this function synchronous makes it usable by both the Zustand
 * action and the inline small-history path without introducing a second state
 * machine.
 */
export function advanceSessionHistoryHydration(
  state: StoreState,
  sessionId: string,
  applyEvent: (state: StoreState, env: EventEnvelope) => boolean,
  suppliedProgress?: HistoryHydrationProgress,
  itemBudget: number = HistoryHydrationPolicy.maxItemsPerSlice,
): boolean {
  const progress = suppliedProgress ?? state.historyHydration?.[sessionId];
  if (!progress) return false;
  const session = state.sessions[sessionId];
  if (!session) {
    clearHistoryLoadingState(state, sessionId);
    return false;
  }

  let remaining = Math.max(1, itemBudget);
  while (remaining > 0) {
    if (progress.phase === "events") {
      const pages = state.historyRunEventBuffers?.[sessionId] ?? [];
      const page = pages[progress.eventPageIndex];
      if (!page) {
        progress.phase = "steps";
        continue;
      }
      while (progress.eventItemIndex < page.length && remaining > 0) {
        applyEvent(state, page[progress.eventItemIndex]!);
        progress.eventItemIndex += 1;
        remaining -= 1;
      }
      if (progress.eventItemIndex >= page.length) {
        pages[progress.eventPageIndex] = [];
        progress.eventPageIndex += 1;
        progress.eventItemIndex = 0;
      }
      continue;
    }

    if (progress.phase === "steps") {
      const pages = state.historyStepBuffers[sessionId] ?? [];
      const page = pages[progress.stepPageIndex];
      if (!page) {
        progress.phase = "entries";
        continue;
      }
      const start = progress.stepItemIndex;
      const end = Math.min(page.length, start + remaining);
      if (end > start) {
        reconcileHistoryStepRuns(session, page.slice(start, end), false);
        const requestIds = page.slice(start, end).map((run) => run.requestId);
        for (const requestId of requestIds) progress.recoveredRequestIds[requestId] = true;
        progress.stepItemIndex = end;
        remaining -= end - start;
      }
      if (progress.stepItemIndex >= page.length) {
        pages[progress.stepPageIndex] = [];
        progress.stepPageIndex += 1;
        progress.stepItemIndex = 0;
      }
      continue;
    }

    const pages = state.historyReplayBuffers[sessionId] ?? [];
    const page = pages[progress.entryPageIndex];
    if (!page) {
      finalizeHistoryHydration(state, sessionId, progress);
      return false;
    }
    const start = progress.entryItemIndex;
    const end = Math.min(page.length, start + remaining);
    if (end > start) {
      const completedRequestIds = new Set(Object.keys(progress.completedRequestIds));
      const projected = page
        .slice(start, end)
        .map((item) => projectEntryToMessage(item.entry, item.visible, completedRequestIds))
        .filter((message): message is ChatMessage => Boolean(message));
      mergeHistoryMessages(session, projected, {
        sort: false,
        placement: progress.entryDirection,
      });
      progress.entryItemIndex = end;
      remaining -= end - start;
    }
    if (progress.entryItemIndex >= page.length) {
      pages[progress.entryPageIndex] = [];
      progress.entryItemIndex = 0;
      progress.entryPageIndex += progress.entryDirection === "prepend" ? -1 : 1;
    }
  }

  return true;
}

function createHistoryHydrationProgress(
  state: StoreState,
  sessionId: string,
  completedAt: string,
): HistoryHydrationProgress {
  const stepPages = state.historyStepBuffers[sessionId] ?? [];
  const eventRunIds = state.historyEventRunIds[sessionId] ?? {};
  const completedRequestIds: Record<string, boolean> = {};
  const recoveredRequestIds: Record<string, boolean> = { ...eventRunIds };
  for (const page of stepPages) {
    for (const run of page) {
      recoveredRequestIds[run.requestId] = true;
      if (run.status === "completed") completedRequestIds[run.requestId] = true;
    }
  }
  const entryPages = state.historyReplayBuffers[sessionId] ?? [];
  const prepended = state.historyPreviewedIds?.[sessionId] === true;
  const activeRequestId = state.historyActiveRequestIds[sessionId] ?? undefined;
  return {
    phase: "events",
    entryPageIndex: prepended ? entryPages.length - 1 : 0,
    entryItemIndex: 0,
    stepPageIndex: 0,
    stepItemIndex: 0,
    eventPageIndex: 0,
    eventItemIndex: 0,
    entryDirection: prepended ? "prepend" : "append",
    completedAt,
    completedRequestIds,
    recoveredRequestIds,
    activeRequestId,
    activeStream: captureActiveStream(state, sessionId, activeRequestId),
  };
}

function historyWorkSize(state: StoreState, sessionId: string): number {
  const entries = (state.historyReplayBuffers[sessionId] ?? []).reduce((total, page) => total + page.length, 0);
  const steps = (state.historyStepBuffers[sessionId] ?? []).reduce((total, page) => total + page.length, 0);
  const events = (state.historyRunEventBuffers?.[sessionId] ?? []).reduce((total, page) => total + page.length, 0);
  return entries + steps + events;
}

function finalizeHistoryHydration(state: StoreState, sessionId: string, progress: HistoryHydrationProgress): void {
  const session = state.sessions[sessionId];
  if (!session) {
    clearHistoryLoadingState(state, sessionId);
    return;
  }

  session.messages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  session.runs.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const activeRequestId = resolveHydrationActiveRequestId(session, progress);
  if (progress.activeStream && activeRequestId === progress.activeStream.requestId) {
    restoreActiveStream(state, sessionId, progress.activeStream);
  }
  closeRecoveredRunningRuns(
    session,
    progress.completedAt,
    new Set(Object.keys(progress.recoveredRequestIds)),
    activeRequestId,
  );
  clearHistoryLoadingState(state, sessionId);
  state.historyLoadedIds[sessionId] = true;
  syncSessionCountsFromLoadedMessages(session);
}

function resolveHydrationActiveRequestId(
  session: SessionRecord,
  progress: HistoryHydrationProgress,
): string | undefined {
  const snapshotActiveRequestId = progress.activeRequestId;
  const currentActiveRequestId = session.activeRequestId;

  // Replay events can temporarily make an old historical run look active. Keep
  // the server snapshot as the authority for recovered requests, while still
  // preserving a new live request started after the wire replay completed.
  if (
    currentActiveRequestId &&
    currentActiveRequestId !== snapshotActiveRequestId &&
    !progress.recoveredRequestIds[currentActiveRequestId]
  ) {
    return currentActiveRequestId;
  }

  if (currentActiveRequestId === undefined) {
    const snapshotRun = snapshotActiveRequestId
      ? session.runs.find((run) => run.requestId === snapshotActiveRequestId)
      : undefined;
    if (snapshotRun?.status === "running") return snapshotActiveRequestId;
    return undefined;
  }

  return snapshotActiveRequestId;
}

function captureActiveStream(
  state: StoreState,
  sessionId: string,
  restoredRequestId: string | undefined,
): HistoryActiveStreamSnapshot | undefined {
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

function restoreActiveStream(state: StoreState, sessionId: string, snapshot: HistoryActiveStreamSnapshot): void {
  const session = state.sessions[sessionId];
  const run = session?.runs.find((entry) => entry.requestId === snapshot.requestId);
  if (!session || !run) return;
  Object.assign(run, snapshot);
  session.activeRequestId = snapshot.requestId;
}

function reconcileHistoryStepRuns(
  session: SessionRecord,
  snapshots: SessionHistoryStepsData["runs"],
  sort = true,
): void {
  if (snapshots.length === 0) return;

  const runsByRequestId = new Map(session.runs.map((run) => [run.requestId, run] as const));
  for (const snapshot of snapshots) {
    const recovered = rebuildRunFromHistory(snapshot);
    const existing = runsByRequestId.get(snapshot.requestId);
    if (!existing) {
      session.runs.push(recovered);
      runsByRequestId.set(snapshot.requestId, recovered);
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
  if (sort) session.runs.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
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
  if (state.historyRunEventBuffers) delete state.historyRunEventBuffers[sessionId];
  if (state.historyPreviewedIds) delete state.historyPreviewedIds[sessionId];
  if (state.historyHydration) delete state.historyHydration[sessionId];
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
