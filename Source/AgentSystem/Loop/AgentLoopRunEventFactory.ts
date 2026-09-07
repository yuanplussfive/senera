import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentProjectedTerminalResult } from "../Runtime/AgentExecutionProjector.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";

export class AgentLoopRunEventFactory {
  runStarted(requestId: string, input: string, approvalMode: AgentExecutionApprovalMode): AgentDomainEvent {
    return {
      kind: AgentEventKinds.RunStarted,
      context: { requestId },
      data: { input, approvalMode },
    };
  }

  finalAnswer(
    requestId: string,
    messageId: string,
    content: string,
    terminal: boolean,
  ): Extract<AgentDomainEvent, { kind: typeof AgentEventKinds.AssistantMessageCreated }> {
    return {
      kind: AgentEventKinds.AssistantMessageCreated,
      context: { requestId },
      data: {
        messageId,
        kind: "final_answer",
        content,
        terminal,
      },
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
