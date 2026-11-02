import type { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type {
  AgentInteractionInputEventPayload,
  AgentInteractionInputRequestedData,
  AgentInteractionInputResolvedData,
} from "../Core/AgentInteractionInputContract.js";

export type AgentInteractionInputDomainEvent =
  | {
      kind: typeof AgentEventKinds.InteractionInputRequested;
      context: Required<Pick<AgentEventContext, "sessionId" | "requestId" | "step">>;
      data: AgentInteractionInputRequestedData;
    }
  | {
      kind: typeof AgentEventKinds.InteractionInputResolved;
      context: Required<Pick<AgentEventContext, "sessionId" | "requestId" | "step">>;
      data: AgentInteractionInputResolvedData;
    };

export type AgentInteractionInputEventData = AgentInteractionInputEventPayload;
