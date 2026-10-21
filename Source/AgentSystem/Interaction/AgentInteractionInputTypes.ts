import type { AgentEventSink } from "../Events/AgentEvent.js";

export type AgentInteractionInputValue = string | number | boolean | string[];
export type AgentInteractionInputContent = Record<string, AgentInteractionInputValue>;

export type AgentInteractionInputProperty =
  | {
      type: "string";
      title?: string;
      description?: string;
      minLength?: number;
      maxLength?: number;
      format?: "email" | "uri" | "date" | "date-time";
      enum?: string[];
      enumNames?: string[];
      oneOf?: Array<{ const: string; title: string }>;
      default?: string;
    }
  | {
      type: "number";
      title?: string;
      description?: string;
      minimum?: number;
      maximum?: number;
      default?: number;
    }
  | {
      type: "integer";
      title?: string;
      description?: string;
      minimum?: number;
      maximum?: number;
      default?: number;
    }
  | {
      type: "boolean";
      title?: string;
      description?: string;
      default?: boolean;
    }
  | {
      type: "array";
      title?: string;
      description?: string;
      minItems?: number;
      maxItems?: number;
      items: { type?: "string"; enum?: string[]; anyOf?: Array<{ const: string; title: string }> };
      default?: string[];
    };

export interface AgentInteractionInputSchema {
  $schema?: string;
  type: "object";
  properties: Record<string, AgentInteractionInputProperty>;
  required?: string[];
}

export const AgentInteractionInputActions = {
  Accept: "accept",
  Decline: "decline",
  Cancel: "cancel",
} as const;

export const AgentInteractionInputModes = {
  Form: "form",
  Url: "url",
} as const;

export type AgentInteractionInputMode = (typeof AgentInteractionInputModes)[keyof typeof AgentInteractionInputModes];

export type AgentInteractionInputAction =
  (typeof AgentInteractionInputActions)[keyof typeof AgentInteractionInputActions];

export interface AgentInteractionInputOwner {
  sessionId: string;
  requestId: string;
  step: number;
  toolCallId: string;
  batchId?: string;
  toolName: string;
}

interface AgentInteractionInputRequestBase extends AgentInteractionInputOwner {
  interactionId: string;
  message: string;
  createdAt: string;
  deadlineAt?: string;
}

export type AgentInteractionInputRequest = AgentInteractionInputRequestBase &
  (
    | {
        mode: typeof AgentInteractionInputModes.Form;
        schema: AgentInteractionInputSchema;
      }
    | {
        mode: typeof AgentInteractionInputModes.Url;
        externalId: string;
        url: string;
        hostname: string;
      }
  );

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
