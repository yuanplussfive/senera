import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentSessionMessageRequest } from "./AgentSessionMessageCoordinator.js";
import type { AgentSessionMessageQueueMode } from "./AgentSessionMessageQueueMode.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";

import type { AgentSessionInputState } from "../Core/AgentSessionInputContract.js";
export { AgentSessionInputStates, type AgentSessionInputState } from "../Core/AgentSessionInputContract.js";

/** Callbacks and speculative preparation never belong in the durable inbox. */
export type AgentSessionQueuedRequest = Omit<
  AgentSessionMessageRequest,
  "onEvent" | "admissionGuard" | "preparation"
> & { readonly requestId: string; readonly queueMode: AgentSessionMessageQueueMode };

export interface AgentSessionQueuedInput {
  readonly sessionId: string;
  readonly requestId: string;
  readonly parentRequestId: string;
  readonly payloadHash: string;
  readonly state: AgentSessionInputState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly request: AgentSessionQueuedRequest;
  readonly entry: Extract<AgentConversationEntry, { kind: "user.message" }>;
  readonly wireInput?: string;
  readonly errorMessage?: string;
}

export interface AgentSessionInputRepository {
  saveQueuedInput(input: AgentSessionQueuedInput): void;
  loadQueuedInput(sessionId: string, requestId: string): AgentSessionQueuedInput | undefined;
  listQueuedInputs(sessionId?: string): AgentSessionQueuedInput[];
}

export interface AgentSessionInputBoundary {
  readonly sessionId: string;
  readonly requestId: string;
  readonly interaction?: AgentInteractionContext;
  readonly phase: import("../Pi/AgentPiInputBoundary.js").AgentPiInputBoundary["phase"];
  readonly continuation?: boolean;
  /** User messages already committed to the native Pi transcript. */
  readonly committedInputs: ReadonlySet<string>;
  readonly committedToolCalls?: ReadonlySet<string>;
  readonly humanInput?: boolean;
  readonly hostInput?: import("../ModelEndpoints/AgentModelMetadata.js").AgentConversationEntryMetadata["hostInput"];
}

export interface AgentSessionInputSource {
  observed?(boundary: AgentSessionInputBoundary): void | Promise<void>;
  beforeInput(boundary: AgentSessionInputBoundary): void | Promise<void>;
  delivered?(input: AgentSessionQueuedInput): void | Promise<void>;
}

export class AgentSessionQueuedMessageConflictError extends AgentBaseError {
  constructor(
    readonly sessionId: string,
    readonly requestId: string,
  ) {
    super(`Queued session message identity conflict: ${sessionId}/${requestId}`);
  }
}

export function assertMatchingQueuedInput(existing: AgentSessionQueuedInput, input: AgentSessionQueuedInput): void {
  if (existing.payloadHash !== input.payloadHash)
    throw new AgentSessionQueuedMessageConflictError(input.sessionId, input.requestId);
}
