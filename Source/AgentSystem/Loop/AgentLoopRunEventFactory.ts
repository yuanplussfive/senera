import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentProjectedTerminalResult } from "../Runtime/AgentExecutionProjector.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentModelUsage } from "../ModelEndpoints/AgentModelUsage.js";

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
    step?: number,
    modelMessageIndex?: number,
    modelContentIndex?: number,
  ): Extract<AgentDomainEvent, { kind: typeof AgentEventKinds.AssistantMessageCreated }> {
    return {
      kind: AgentEventKinds.AssistantMessageCreated,
      context: { requestId, ...(step === undefined ? {} : { step }) },
      data: {
        messageId,
        kind: "final_answer",
        content,
        terminal,
        ...(modelMessageIndex === undefined ? {} : { modelMessageIndex }),
        ...(modelContentIndex === undefined ? {} : { modelContentIndex }),
      },
    };
  }

  terminal(projected: AgentProjectedTerminalResult, requestId: string, usage?: AgentModelUsage): AgentDomainEvent[] {
    return [
      projected.event,
      {
        kind: AgentEventKinds.RunCompleted,
        context: { requestId },
        data: usage ? { usage } : {},
      },
    ];
  }
}
