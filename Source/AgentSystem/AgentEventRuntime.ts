import {
  AgentEventChannels,
  type AgentEventKind,
  getAgentEventSpec,
} from "./AgentEventCatalog.js";
import type {
  AgentEventContext,
  AgentEventEnvelope,
} from "./AgentEventBase.js";
import type {
  AgentDomainEvent,
  AgentEventSink,
} from "./AgentEventTypes.js";

export class AgentEventSequencer {
  private sequence = 0;

  next(): number {
    this.sequence += 1;
    return this.sequence;
  }
}

export function createEventDetailId(
  requestId: string | undefined,
  step: number | undefined,
  kind: AgentEventKind,
  suffix: string,
): string {
  return [
    requestId ?? "global",
    step ?? "na",
    kind,
    suffix,
  ].join(":");
}

export function toEventEnvelope(
  event: AgentDomainEvent,
  sequence: number,
): AgentEventEnvelope<AgentEventKind, unknown> {
  const spec = getAgentEventSpec(event.kind);
  const detailId = readDetailId(event.data);
  const context = event.context as AgentEventContext;
  const step = context.step;

  return {
    channel: AgentEventChannels.AgentEvent,
    kind: event.kind,
    layer: spec.layer,
    phase: spec.phase,
    sequence,
    timestamp: new Date().toISOString(),
    sessionId: context.sessionId,
    requestId: context.requestId,
    step,
    detailId,
    data: event.data,
  };
}

export async function emitAgentEvent(
  sink: AgentEventSink | undefined,
  event: AgentDomainEvent,
): Promise<void> {
  await sink?.(event);
}

export function withEventContext(
  event: AgentDomainEvent,
  context: Partial<AgentEventContext>,
): AgentDomainEvent {
  return {
    ...event,
    context: {
      ...event.context,
      ...context,
    },
  } as AgentDomainEvent;
}

function readDetailId(data: unknown): string | undefined {
  return data && typeof data === "object" && "detailId" in data
    ? String((data as { detailId?: unknown }).detailId ?? "")
    : undefined;
}
