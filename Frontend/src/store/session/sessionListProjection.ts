import type { SessionListItem } from "../../api/eventTypes";
import type { SessionRecord, StoreState } from "./types";
import { forgetSessionEventReceiptsForSessions } from "./eventReceiptLedger";

export function ingestSessionList(state: StoreState, items: readonly SessionListItem[]): void {
  const serverIds = new Set(items.map((item) => item.sessionId));

  for (const pendingId of Object.keys(state.pendingDeletedSessionIds)) {
    if (serverIds.has(pendingId)) continue;
    delete state.pendingDeletedSessionIds[pendingId];
    deleteSessionRuntimeState(state, pendingId);
  }

  const visibleItems = items.filter(
    (item) => !state.pendingDeletedSessionIds[item.sessionId] && !state.childSessionParentIds[item.sessionId],
  );
  // Keep hidden child records in runtime state so the relation remains stable
  // across later list snapshots; only sessionOrder controls top-level visibility.
  const visibleServerIds = new Set(serverIds);

  for (const item of visibleItems) {
    delete state.pendingCreatedSessionIds[item.sessionId];
    projectSessionListItem(state, item);
    delete state.missingOnServerIds[item.sessionId];
  }

  const pendingCreatedOrdered = state.sessionOrder.filter(
    (id) => state.pendingCreatedSessionIds[id] && state.sessions[id] && !visibleServerIds.has(id),
  );
  const preferredVisibleOrder = state.sessionOrder.filter(
    (id) => visibleServerIds.has(id) && !state.pendingDeletedSessionIds[id] && !state.childSessionParentIds[id],
  );
  state.sessionOrder = mergeSessionOrder(
    pendingCreatedOrdered.filter((id) => !state.childSessionParentIds[id]),
    preferredVisibleOrder,
    visibleItems.map((item) => item.sessionId),
  );

  syncActiveSessionAfterListIngest(state, visibleItems);
  pruneLocalSessionsNotOnServer(state, visibleServerIds);
}

export function readFirstAvailableSessionId(state: StoreState, excludedSessionId?: string): string | null {
  return (
    state.sessionOrder.find(
      (id) =>
        id !== excludedSessionId &&
        Boolean(state.sessions[id]) &&
        !state.missingOnServerIds[id] &&
        !state.pendingDeletedSessionIds[id] &&
        !state.childSessionParentIds[id],
    ) ?? null
  );
}

/**
 * Hide a deletion request from the list while retaining its runtime record.
 * The backend close is asynchronous and may fail while an active run is
 * settling, so local state cannot be discarded at send time.
 */
export function markSessionDeletionRequested(state: StoreState, sessionIds: readonly string[]): void {
  const ids = new Set(sessionIds.filter(Boolean));
  if (ids.size === 0) return;

  for (const sessionId of ids) {
    state.pendingDeletedSessionIds[sessionId] = true;
    delete state.pendingCreatedSessionIds[sessionId];
  }

  state.sessionOrder = state.sessionOrder.filter((sessionId) => !ids.has(sessionId));
  if (state.activeSessionId && ids.has(state.activeSessionId)) {
    state.activeSessionId = readFirstAvailableSessionId(state);
  }
}

/** Restore a deletion request after the backend reports that close failed. */
export function restorePendingSessionDeletion(state: StoreState, sessionIds: readonly string[]): void {
  const restoredIds = new Set<string>();
  for (const sessionId of new Set(sessionIds.filter(Boolean))) {
    if (!state.pendingDeletedSessionIds[sessionId] || !state.sessions[sessionId]) continue;
    delete state.pendingDeletedSessionIds[sessionId];
    delete state.missingOnServerIds[sessionId];
    state.historyLoadingIds[sessionId] = false;
    delete state.historyReplayBuffers[sessionId];
    delete state.historyStepBuffers[sessionId];
    delete state.historyEventRunIds[sessionId];
    delete state.historyActiveRequestIds[sessionId];
    delete state.historyFailedIds[sessionId];
    if (!state.childSessionParentIds[sessionId]) restoredIds.add(sessionId);
  }

  for (const sessionId of restoredIds) {
    if (!state.sessionOrder.includes(sessionId)) state.sessionOrder.push(sessionId);
  }
  if (!state.activeSessionId) state.activeSessionId = readFirstAvailableSessionId(state);
}

export function deleteSessionRuntimeState(state: StoreState, sessionId: string): void {
  deleteSessionRuntimeStates(state, [sessionId]);
}

export function deleteSessionRuntimeStates(state: StoreState, sessionIds: readonly string[]): void {
  const ids = new Set(sessionIds);
  if (ids.size === 0) return;

  for (const sessionId of ids) {
    delete state.sessions[sessionId];
    delete state.historyLoadedIds[sessionId];
    delete state.historyLoadingIds[sessionId];
    delete state.historyFailedIds[sessionId];
    delete state.historyReplayBuffers[sessionId];
    delete state.historyStepBuffers[sessionId];
    delete state.historyEventRunIds[sessionId];
    delete state.historyActiveRequestIds[sessionId];
    delete state.viewedRunIdBySession[sessionId];
    delete state.missingOnServerIds[sessionId];
    delete state.selectedModelProviderIdsBySession[sessionId];
    delete state.childSessionParentIds[sessionId];
  }

  for (const [childSessionId, parentSessionId] of Object.entries(state.childSessionParentIds)) {
    if (ids.has(childSessionId) || ids.has(parentSessionId)) delete state.childSessionParentIds[childSessionId];
  }
  forgetSessionEventReceiptsForSessions(state, [...ids]);
  state.sessionOrder = state.sessionOrder.filter((id) => !ids.has(id));
}

function projectSessionListItem(state: StoreState, item: SessionListItem): void {
  const existing = state.sessions[item.sessionId];
  if (existing) {
    existing.title = item.title;
    existing.status = item.status === "running" ? "ready" : (item.status as SessionRecord["status"]);
    existing.updatedAt = item.updatedAt;
    existing.createdAt = item.createdAt;
    existing.entryCount = item.entryCount;
    existing.messageCount = item.messageCount;
    existing.activeRequestId = item.activeRequestId;
    existing.channel = item.channel;
    if (state.historyLoadingIds[item.sessionId]) {
      state.historyActiveRequestIds[item.sessionId] = item.activeRequestId ?? null;
    }
    settleStaleHistoryLoading(state, existing);
    return;
  }

  const session: SessionRecord = {
    sessionId: item.sessionId,
    title: item.title,
    status: "ready",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    entryCount: item.entryCount,
    messageCount: item.messageCount,
    messages: [],
    runs: [],
    activeRequestId: item.activeRequestId,
    channel: item.channel,
  };
  state.sessions[item.sessionId] = session;
  settleStaleHistoryLoading(state, session);
}

function settleStaleHistoryLoading(state: StoreState, session: SessionRecord): void {
  if (!state.historyLoadingIds[session.sessionId]) {
    return;
  }

  const hasRecoveringRun = session.runs.some((run) => run.status === "running" && run.recoverySource === "history");
  const hasMissingMessages = session.messageCount > 0 && session.messages.length === 0;
  if (hasRecoveringRun || hasMissingMessages) {
    return;
  }

  state.historyLoadingIds[session.sessionId] = false;
  delete state.historyReplayBuffers[session.sessionId];
  delete state.historyStepBuffers[session.sessionId];
  delete state.historyEventRunIds[session.sessionId];
  delete state.historyActiveRequestIds[session.sessionId];
}

function syncActiveSessionAfterListIngest(state: StoreState, visibleItems: readonly SessionListItem[]): void {
  const fallbackActiveSessionId = readPreferredActiveSessionId(state, visibleItems);
  const activeId = state.activeSessionId;
  const activeInOrder = activeId ? state.sessionOrder.includes(activeId) : false;

  if (activeId && !activeInOrder && state.sessionOrder.length > 0) {
    state.activeSessionId = fallbackActiveSessionId;
    return;
  }

  if (activeId && !activeInOrder && state.sessionOrder.length === 0) {
    state.activeSessionId = null;
    return;
  }

  if (!activeId && state.sessionOrder.length > 0) {
    state.activeSessionId = fallbackActiveSessionId;
  }
}

function readPreferredActiveSessionId(state: StoreState, visibleItems: readonly SessionListItem[]): string | null {
  const pendingCreatedId = state.sessionOrder.find((id) => state.pendingCreatedSessionIds[id] && state.sessions[id]);
  if (pendingCreatedId) return pendingCreatedId;
  return visibleItems.find((item) => item.messageCount > 0)?.sessionId ?? visibleItems[0]?.sessionId ?? null;
}

function pruneLocalSessionsNotOnServer(state: StoreState, visibleServerIds: ReadonlySet<string>): void {
  for (const localId of Object.keys(state.sessions)) {
    const shouldKeep =
      visibleServerIds.has(localId) ||
      Boolean(state.pendingCreatedSessionIds[localId]) ||
      Boolean(state.pendingDeletedSessionIds[localId]);
    if (!shouldKeep) {
      deleteSessionRuntimeState(state, localId);
    }
  }
}

function mergeSessionOrder(...groups: readonly string[][]): string[] {
  return [...new Set(groups.flat())];
}
