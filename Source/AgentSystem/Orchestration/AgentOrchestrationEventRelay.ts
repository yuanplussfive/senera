import type { AgentDomainEvent, AgentEventSink } from "../Events/AgentEvent.js";

export class AgentOrchestrationEventRelay {
  private sink?: AgentEventSink;

  setSink(sink: AgentEventSink | undefined): void {
    this.sink = sink;
  }

  emit(event: AgentDomainEvent): Promise<void> {
    return Promise.resolve(this.sink?.(event));
  }
}
