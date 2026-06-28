import type { AgentEventContext } from "../Events/AgentEventBase.js";
import { AgentEventKinds } from "../Events/AgentEventCatalog.js";

type AgentRequestContext = Required<Pick<AgentEventContext, "requestId">>;

export type AgentRunDomainEvent =
  | {
      kind: typeof AgentEventKinds.RunStarted;
      context: AgentRequestContext;
      data: {
        input: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.FinalAnswer;
      context: AgentRequestContext;
      data: {
        content: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.AskUser;
      context: AgentRequestContext;
      data: {
        question: string;
        reasonCode?: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.RunCompleted;
      context: AgentRequestContext;
      data: Record<string, never>;
    }
  | {
      kind: typeof AgentEventKinds.RunFailed;
      context: AgentRequestContext & Partial<Pick<AgentEventContext, "step" | "sessionId">>;
      data: {
        message: string;
        code?: string;
        details?: unknown;
      };
    }
  | {
      kind: typeof AgentEventKinds.RunCancelled;
      context: AgentRequestContext & Partial<Pick<AgentEventContext, "step" | "sessionId">>;
      data: {
        reason: "user_cancelled";
      };
    }
  | {
      kind: typeof AgentEventKinds.RequestInvalid;
      context: AgentEventContext;
      data: {
        message: string;
        details?: unknown;
      };
    };

