import type { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type {
  AgentInteractionInputAction,
  AgentInteractionInputContent,
  AgentInteractionInputOwner,
  AgentInteractionInputRequest,
} from "./AgentInteractionInputTypes.js";

export type AgentInteractionInputDomainEvent =
  | {
      kind: typeof AgentEventKinds.InteractionInputRequested;
      context: Required<Pick<AgentEventContext, "sessionId" | "requestId" | "step">>;
      data: AgentInteractionInputEventData & { status: "pending" };
    }
  | {
      kind: typeof AgentEventKinds.InteractionInputResolved;
      context: Required<Pick<AgentEventContext, "sessionId" | "requestId" | "step">>;
      data: AgentInteractionInputEventData & {
        status: "external_pending" | "resolved" | "expired";
        action: AgentInteractionInputAction;
        content?: AgentInteractionInputContent;
        resolutionMessage?: string;
        resolvedAt: string;
      };
    };

export type AgentInteractionInputEventData = Omit<AgentInteractionInputRequest, keyof AgentInteractionInputOwner>;
