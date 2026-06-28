import {
  AgentEventKinds,
  summarizePrompt,
  type AgentDomainEvent,
} from "../AgentEvent.js";

export class AgentLoopPromptEventFactory {
  promptRendered(
    requestId: string,
    step: number,
    prompt: string,
    tokenCount: number,
  ): AgentDomainEvent[] {
    const summary = summarizePrompt(prompt, tokenCount);

    return [
      {
        kind: summary.kind,
        context: { requestId, step },
        data: summary.data,
      },
      {
        kind: AgentEventKinds.PromptRendered,
        context: { requestId, step },
        data: { prompt },
      },
    ];
  }
}

