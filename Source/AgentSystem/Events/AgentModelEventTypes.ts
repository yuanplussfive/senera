import type { AgentEventContext } from "../Events/AgentEventBase.js";
import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";

type AgentStepContext = Required<Pick<AgentEventContext, "requestId" | "step">>;

export type AgentModelDomainEvent =
  | {
      kind: typeof AgentEventKinds.ModelStarted;
      context: AgentStepContext;
      data: {
        model: string;
        provider?: AgentModelProviderMetadata;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelStreamOpened;
      context: AgentStepContext;
      data: {
        provider?: AgentModelProviderMetadata;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelDelta;
      context: AgentStepContext;
      data: {
        text: string;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelCompleted;
      context: AgentStepContext;
      data: {
        text: string;
        provider?: AgentModelProviderMetadata;
      };
    }
  | {
      kind: typeof AgentEventKinds.ModelStreamAborted;
      context: AgentStepContext;
      data: {
        reason: string;
      };
    };

