import type { AgentLanguageModelRequest, AgentLanguageModelStream } from "./AgentLanguageModel.js";
import type { resolveModelProviderConfig } from "../AgentDefaults.js";
import type { ModelHttpClient } from "./ModelHttpClient.js";
import type { AgentModelUsageValue } from "./AgentModelUsage.js";
import { ClaudeMessagesEndpoint } from "./ClaudeMessagesEndpoint.js";
import { GoogleGenerateContentEndpoint } from "./GoogleGenerateContentEndpoint.js";
import { OpenAiChatCompletionsEndpoint } from "./OpenAiChatCompletionsEndpoint.js";
import { OpenAiResponsesEndpoint } from "./OpenAiResponsesEndpoint.js";

export type ModelProviderConfig = ReturnType<typeof resolveModelProviderConfig>;
export type ModelEndpoint = ModelProviderConfig["Endpoint"];
export type JsonObject = Record<string, unknown>;
export type ModelHttpPathSegment = string | { value: string; encode: "component" | "path" };

export interface TextGenerationEndpointResult {
  text: string;
  usage?: AgentModelUsageValue;
}

export interface TextGenerationEndpoint {
  complete(request: AgentLanguageModelRequest): Promise<TextGenerationEndpointResult>;
  stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream>;
}

export interface EndpointRuntime {
  config: ModelProviderConfig;
  http: ModelHttpClient;
}

export function createModelEndpoint(endpoint: ModelEndpoint, runtime: EndpointRuntime): TextGenerationEndpoint {
  const endpoints: Record<ModelEndpoint, (item: EndpointRuntime) => TextGenerationEndpoint> = {
    Responses: (item) => new OpenAiResponsesEndpoint(item),
    ChatCompletions: (item) => new OpenAiChatCompletionsEndpoint(item),
    ClaudeMessages: (item) => new ClaudeMessagesEndpoint(item),
    GoogleGenerateContent: (item) => new GoogleGenerateContentEndpoint(item),
  };

  return endpoints[endpoint](runtime);
}
