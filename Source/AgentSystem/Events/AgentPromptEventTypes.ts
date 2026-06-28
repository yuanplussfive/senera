import type { AgentEventContext } from "../AgentEventBase.js";
import { AgentEventKinds } from "../AgentEventCatalog.js";

type AgentStepContext = Required<Pick<AgentEventContext, "requestId" | "step">>;

export type AgentPromptDomainEvent =
  | {
      kind: typeof AgentEventKinds.PromptRendered;
      context: AgentStepContext;
      data: {
        prompt: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.PromptSummary;
      context: AgentStepContext;
      data: {
        chars: number;
        lines: number;
        tokenCount: number;
      };
    };

