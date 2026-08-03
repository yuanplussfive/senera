import type { EventEnvelope } from "../../api/eventTypes";
import {
  AgentEventReceiptRetentionPolicy,
  normalizeAgentEventId,
  readAgentEventProjectionSources,
} from "../../api/eventDeliveryIdentity";

export interface AgentEventReceiptState {
  processedEventIds: Record<string, string | null>;
  processedEventIdOrder: string[];
}

export function projectAgentEventOnce(
  state: AgentEventReceiptState,
  event: EventEnvelope,
  project: (event: EventEnvelope) => void,
): boolean {
  const sources = readAgentEventProjectionSources(event);
  const unseen = readUnseenSources(state, sources);
  if (unseen.length === 0) return false;

  if (unseen.length === sources.length) {
    project(event);
    for (const source of sources) recordEventReceipt(state, source);
    return true;
  }

  for (const source of unseen) {
    project(source);
    recordEventReceipt(state, source);
  }
  return true;
}

export function forgetSessionEventReceipts(state: AgentEventReceiptState, sessionId: string): void {
  const removed = new Set(
    Object.entries(state.processedEventIds)
      .filter(([, ownerSessionId]) => ownerSessionId === sessionId)
      .map(([eventId]) => eventId),
  );
  if (removed.size === 0) return;
  for (const eventId of removed) delete state.processedEventIds[eventId];
  state.processedEventIdOrder = state.processedEventIdOrder.filter((eventId) => !removed.has(eventId));
}

function readUnseenSources(state: AgentEventReceiptState, sources: readonly EventEnvelope[]): EventEnvelope[] {
  const pendingIds = new Set<string>();
  return sources.filter((source) => {
    const eventId = normalizeAgentEventId(source.eventId);
    if (!eventId) return true;
    if (Object.prototype.hasOwnProperty.call(state.processedEventIds, eventId) || pendingIds.has(eventId)) return false;
    pendingIds.add(eventId);
    return true;
  });
}

function recordEventReceipt(state: AgentEventReceiptState, event: EventEnvelope): void {
  const eventId = normalizeAgentEventId(event.eventId);
  if (!eventId || Object.prototype.hasOwnProperty.call(state.processedEventIds, eventId)) return;
  state.processedEventIds[eventId] = event.sessionId ?? null;
  state.processedEventIdOrder.push(eventId);

  const overflow = state.processedEventIdOrder.length - AgentEventReceiptRetentionPolicy.maxIds;
  if (overflow <= 0) return;
  const removalCount = Math.max(overflow, AgentEventReceiptRetentionPolicy.evictionBatchSize);
  for (const expiredId of state.processedEventIdOrder.splice(0, removalCount)) {
    delete state.processedEventIds[expiredId];
  }
}
