import type { AgentEventContext } from "../Events/AgentEventBase.js";
import { AgentEventKinds } from "../Events/AgentEventCatalog.js";

type AgentStepContext = Required<Pick<AgentEventContext, "requestId" | "step">>;

export type AgentPromptDomainEvent = {
  kind: typeof AgentEventKinds.PromptSummary;
  context: AgentStepContext;
  data: {
    chars: number;
    lines: number;
    tokenCount: number;
  };
};
