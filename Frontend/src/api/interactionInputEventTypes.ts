export type InteractionInputAction = "accept" | "decline" | "cancel";
export type InteractionInputValue = string | number | boolean | string[];
export type InteractionInputContent = Record<string, InteractionInputValue>;

export type InteractionInputProperty =
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

export interface InteractionInputSchema {
  $schema?: string;
  type: "object";
  properties: Record<string, InteractionInputProperty>;
  required?: string[];
}

interface InteractionInputEventBase {
  interactionId: string;
  message: string;
  toolName: string;
  toolCallId: string;
  batchId?: string;
  createdAt: string;
  deadlineAt?: string;
}

export type InteractionInputEventPayload = InteractionInputEventBase &
  (
    | { mode: "form"; schema: InteractionInputSchema }
    | { mode: "url"; externalId: string; url: string; hostname: string }
  );

export type InteractionInputRequestedData = InteractionInputEventPayload & { status: "pending" };

export type InteractionInputResolvedData = InteractionInputEventPayload & {
  status: "external_pending" | "resolved" | "expired";
  action: InteractionInputAction;
  content?: InteractionInputContent;
  resolutionMessage?: string;
  resolvedAt: string;
};
