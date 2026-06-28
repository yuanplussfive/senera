import type { SessionListItem } from "../../api/eventTypes";
import type { SessionRecord, StoreState } from "./types";

export function ingestSessionList(
  state: StoreState,
  items: readonly SessionListItem[],
): void {
  const serverIds = new Set(items.map((item) => item.sessionId));

  for (const pendingId of Object.keys(state.pendingDeletedSessionIds)) {
    if (serverIds.has(pendingId)) continue;
    delete state.pendingDeletedSessionIds[pendingId];
    deleteSessionRuntimeState(state, pendingId);
  }

  const visibleItems = items.filter((item) => !state.pendingDeletedSessionIds[item.sessionId]);
  const visibleServerIds = new Set<string>();

  for (const item of visibleItems) {
    visibleServerIds.add(item.sessionId);
    delete state.pendingCreatedSessionIds[item.sessionId];
    projectSessionListItem(state, item);
    delete state.missingOnServerIds[item.sessionId];
  }

  const pendingCreatedOrdered = state.sessionOrder.filter(
    (id) => state.pendingCreatedSessionIds[id] && state.sessions[id] && !visibleServerIds.has(id),
  );
  state.sessionOrder = mergeSessionOrder(
    pendingCreatedOrdered,
    visibleItems.map((item) => item.sessionId),
  );

  syncActiveSessionAfterListIngest(state, visibleItems);
  pruneLocalSessionsNotOnServer(state, visibleServerIds);
}

export function readFirstAvailableSessionId(
  state: StoreState,
  excludedSessionId?: string,
): string | null {
  return state.sessionOrder.find(
    (id) =>
      id !== excludedSessionId &&
      Boolean(state.sessions[id]) &&
      !state.missingOnServerIds[id] &&
      !state.pendingDeletedSessionIds[id],
  ) ?? null;
}

export function deleteSessionRuntimeState(state: StoreState, sessionId: string): void {
  delete state.sessions[sessionId];
  delete state.historyLoadedIds[sessionId];
  delete state.historyLoadingIds[sessionId];
  delete state.historyFailedIds[sessionId];
  delete state.historyReplayBuffers[sessionId];
  delete state.historyStepBuffers[sessionId];
  delete state.historyEventRunIds[sessionId];
  delete state.viewedRunIdBySession[sessionId];
  delete state.missingOnServerIds[sessionId];
  state.sessionOrder = state.sessionOrder.filter((id) => id !== sessionId);
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
    return;
  }

  state.sessions[item.sessionId] = {
    sessionId: item.sessionId,
    title: item.title,
    status: "ready",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    entryCount: item.entryCount,
    messageCount: item.messageCount,
    messages: [],
    runs: [],
  };
}

function syncActiveSessionAfterListIngest(
  state: StoreState,
  visibleItems: readonly SessionListItem[],
): void {
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

function readPreferredActiveSessionId(
  state: StoreState,
  visibleItems: readonly SessionListItem[],
): string | null {
  const pendingCreatedId = state.sessionOrder.find(
    (id) => state.pendingCreatedSessionIds[id] && state.sessions[id],
  );
  if (pendingCreatedId) return pendingCreatedId;
  return visibleItems.find((item) => item.messageCount > 0)?.sessionId
    ?? visibleItems[0]?.sessionId
    ?? null;
}

function pruneLocalSessionsNotOnServer(
  state: StoreState,
  visibleServerIds: ReadonlySet<string>,
): void {
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
