import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentModelProviderMetadata } from "./AgentModelMetadata.js";
import type { AgentModelUsageValue } from "./AgentModelUsage.js";

export interface AgentLanguageModelRequest {
  requestId: string;
  step: number;
  systemPrompt: string;
  messages: AgentLanguageModelMessage[];
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
}

export interface AgentLanguageModelMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string;
}

export interface AgentLanguageModelResponse {
  text: string;
  usage?: AgentModelUsageValue;
}

export interface AgentLanguageModelStreamChunk {
  textDelta: string;
  accumulatedText: string;
}

export interface AgentLanguageModelStream {
  abort(): void;
  readonly metadata: AgentModelProviderMetadata;
  readonly usage?: AgentModelUsageValue;
  [Symbol.asyncIterator](): AsyncIterableIterator<AgentLanguageModelStreamChunk>;
}

export interface AgentLanguageModel {
  readonly metadata: AgentModelProviderMetadata;
  complete(request: AgentLanguageModelRequest): Promise<AgentLanguageModelResponse>;
  stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream>;
}
