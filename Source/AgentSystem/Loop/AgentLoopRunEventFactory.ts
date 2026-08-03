import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentProjectedTerminalResult } from "../Runtime/AgentExecutionProjector.js";

export class AgentLoopRunEventFactory {
  runStarted(requestId: string, input: string): AgentDomainEvent {
    return {
      kind: AgentEventKinds.RunStarted,
      context: { requestId },
      data: { input },
    };
  }

  terminal(projected: AgentProjectedTerminalResult, requestId: string): AgentDomainEvent[] {
    return [
      projected.event,
      {
        kind: AgentEventKinds.RunCompleted,
        context: { requestId },
        data: {},
      },
    ];
  }
}
