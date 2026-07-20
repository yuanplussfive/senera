import type { AgentEventContext } from "../Events/AgentEventBase.js";
import { type AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentModelUsageValue } from "../ModelEndpoints/AgentModelUsage.js";

type AgentStepContext = Required<Pick<AgentEventContext, "requestId" | "step">> &
  Partial<Pick<AgentEventContext, "sessionId">>;

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
        usage?: AgentModelUsageValue;
      };
    }
  | {
      kind: typeof AgentEventKinds.PiTrace;
      context: AgentStepContext;
      data: {
        source: "session" | "proxy" | "tool_bridge" | "substrate";
        eventType: string;
        summary: string;
        payload?: unknown;
      };
    };
