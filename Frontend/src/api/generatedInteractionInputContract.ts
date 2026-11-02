// Generated from AgentInteractionInputContract.ts. Do not edit.
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

interface AgentInteractionInputEventBase {
  interactionId: string;
  message: string;
  toolName: string;
  toolCallId: string;
  batchId?: string;
  createdAt: string;
  deadlineAt?: string;
}

export type AgentInteractionInputEventPayload = AgentInteractionInputEventBase &
  (
    | { mode: "form"; schema: AgentInteractionInputSchema }
    | { mode: "url"; externalId: string; url: string; hostname: string }
  );

export type AgentInteractionInputRequestedData = AgentInteractionInputEventPayload & { status: "pending" };

export type AgentInteractionInputResolvedData = AgentInteractionInputEventPayload & {
  status: "external_pending" | "resolved" | "expired";
  action: AgentInteractionInputAction;
  content?: AgentInteractionInputContent;
  resolutionMessage?: string;
  resolvedAt: string;
};
