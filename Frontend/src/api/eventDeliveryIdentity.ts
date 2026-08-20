import type { EventEnvelope } from "./eventTypes";

export const AgentEventReceiptRetentionPolicy = {
  maxIds: 65_536,
  evictionBatchSize: 4_096,
} as const;

const CoalescedEventSources = new WeakMap<EventEnvelope, readonly EventEnvelope[]>();

export class AgentEventIdWindow {
  private readonly ids = new Set<string>();
  private readonly order: string[] = [];

  accept(event: Pick<EventEnvelope, "eventId">): boolean {
    const eventId = normalizeAgentEventId(event.eventId);
    if (!eventId) return true;
    if (this.ids.has(eventId)) return false;
    this.ids.add(eventId);
    this.order.push(eventId);
    trimAgentEventReceiptWindow(this.ids, this.order);
    return true;
  }
}

export function recordCoalescedEventSources(
  event: EventEnvelope,
  previous: EventEnvelope,
  current: EventEnvelope,
): EventEnvelope {
  CoalescedEventSources.set(event, [
    ...readAgentEventProjectionSources(previous),
    ...readAgentEventProjectionSources(current),
  ]);
  return event;
}

export function readAgentEventProjectionSources(event: EventEnvelope): readonly EventEnvelope[] {
  return CoalescedEventSources.get(event) ?? [event];
}

export function normalizeAgentEventId(eventId: string | undefined): string | undefined {
  const normalized = eventId?.trim();
  return normalized || undefined;
}

export function trimAgentEventReceiptWindow(ids: Set<string>, order: string[]): void {
  const overflow = order.length - AgentEventReceiptRetentionPolicy.maxIds;
  if (overflow <= 0) return;
  const removalCount = Math.max(overflow, AgentEventReceiptRetentionPolicy.evictionBatchSize);
  for (const eventId of order.splice(0, removalCount)) ids.delete(eventId);
}
