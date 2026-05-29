import type { AgentLanguageModelRequest, AgentLanguageModelStream } from "../AgentLanguageModel.js";
import type { resolveModelProviderConfig } from "../AgentDefaults.js";
import type { ModelHttpClient } from "./ModelHttpClient.js";

export type ModelProviderConfig = ReturnType<typeof resolveModelProviderConfig>;
export type ModelEndpoint = ModelProviderConfig["Endpoint"];
export type JsonObject = Record<string, unknown>;
export type ModelHttpPathSegment = string | { value: string; encode: "component" | "path" };

export interface TextGenerationEndpointResult {
  text: string;
}

export interface TextGenerationEndpoint {
  complete(request: AgentLanguageModelRequest): Promise<TextGenerationEndpointResult>;
  stream(request: AgentLanguageModelRequest): Promise<AgentLanguageModelStream>;
}

export interface EndpointRuntime {
  config: ModelProviderConfig;
  http: ModelHttpClient;
}
