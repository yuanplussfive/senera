import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentModelProviderMetadata } from "./AgentModelMetadata.js";
import type { AgentModelUsageValue } from "./AgentModelUsage.js";
import type { AgentModelCompletionMetadata } from "./AgentModelCompletion.js";

export interface AgentLanguageModelRequest {
  requestId: string;
  step: number;
  systemPrompt: string;
  messages: AgentLanguageModelMessage[];
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
}

/**
 * Provider-neutral visual input. The raw data is kept outside the textual
 * prompt so endpoint adapters can project it using their native wire format.
 */
export interface AgentLanguageModelImageAttachment {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

/**
 * Invocation data shared by structured planner calls. Attachments are
 * deliberately orthogonal to the structured prompt payload: image bytes must
 * reach the model as multimodal input, never as serialized prompt text.
 */
export interface AgentLanguageModelInvocationOptions {
  readonly signal?: AbortSignal;
  readonly attachments?: readonly AgentLanguageModelImageAttachment[];
  readonly cache?: AgentLanguageModelCacheOptions;
}

export type AgentModelCacheRetention = "none" | "short" | "long";

/** Provider-neutral prompt-cache affinity passed through Pi. */
export interface AgentLanguageModelCacheOptions {
  readonly scope: string;
  readonly retention: AgentModelCacheRetention;
}

/** Invocation contract for model calls whose immutable system prefix is owned by the caller. */
export interface AgentStablePromptInvocationOptions extends AgentLanguageModelInvocationOptions {
  readonly stableSystemPrompt: string;
  readonly cache: AgentLanguageModelCacheOptions;
}

export interface AgentLanguageModelMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
  /** Native multimodal attachments for this message. */
  attachments?: readonly AgentLanguageModelImageAttachment[];
}

export interface AgentLanguageModelResponse {
  text: string;
  usage?: AgentModelUsageValue;
  completion?: AgentModelCompletionMetadata;
}

export interface AgentLanguageModelStreamChunk {
  textDelta: string;
  accumulatedText: string;
}

export interface AgentLanguageModelStream {
  abort(): void;
  readonly metadata: AgentModelProviderMetadata;
  readonly usage?: AgentModelUsageValue;
  readonly completion?: AgentModelCompletionMetadata;
  [Symbol.asyncIterator](): AsyncIterableIterator<AgentLanguageModelStreamChunk>;
}

export interface AgentLanguageModel {
  readonly metadata: AgentModelProviderMetadata;
  complete(request: AgentLanguageModelRequest): Promise<AgentLanguageModelResponse>;
  stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream>;
}
