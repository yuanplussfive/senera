import type { AgentEventSink } from "../Events/AgentEvent.js";
import {
  AgentInteractionInputModes,
  type AgentInteractionInputAction,
  type AgentInteractionInputContent,
  type AgentInteractionInputEventPayload,
  type AgentInteractionInputSchema,
} from "../Core/AgentInteractionInputContract.js";

export * from "../Core/AgentInteractionInputContract.js";

export interface AgentInteractionInputOwner {
  sessionId: string;
  requestId: string;
  step: number;
  toolCallId: string;
  batchId?: string;
  toolName: string;
}

export type AgentInteractionInputRequest = AgentInteractionInputEventPayload & AgentInteractionInputOwner;

export interface AgentInteractionInputResolution {
  interactionId: string;
  action: AgentInteractionInputAction;
  content?: AgentInteractionInputContent;
  message?: string;
  resolvedAt: string;
}

export type AgentExternalInteractionCompletion = "completed" | "cancelled";

export interface AgentExternalInteractionHandle {
  readonly response: Promise<AgentInteractionInputResolution>;
  readonly completion: Promise<AgentExternalInteractionCompletion>;
}

export interface AgentInteractionInputResolveCommand {
  interactionId: string;
  action: AgentInteractionInputAction;
  content?: AgentInteractionInputContent;
  message?: string;
}

interface AgentInteractionInputWaitOptionsBase {
  owner: AgentInteractionInputOwner;
  message: string;
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
  deadlineMs?: number;
}

export type AgentInteractionInputWaitOptions = AgentInteractionInputWaitOptionsBase &
  (
    | {
        mode: typeof AgentInteractionInputModes.Form;
        schema: AgentInteractionInputSchema;
      }
    | {
        mode: typeof AgentInteractionInputModes.Url;
        externalId: string;
        url: string;
      }
  );
