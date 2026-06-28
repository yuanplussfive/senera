export interface AgentModelProviderConfig {
  Id: string;
  ProviderId: string;
  Icon?: string;
  Capabilities?: AgentModelCapabilitiesConfig;
  ContextWindowTokens?: number;
  MaxModelOutputTokens?: number;
  Endpoint: "Responses" | "ChatCompletions" | "ClaudeMessages" | "GoogleGenerateContent";
  Model: string;
  Temperature?: number;
  MaxOutputTokens?: number;
  Stream?: boolean;
  TimeoutSeconds?: number;
  FirstTokenTimeoutSeconds?: number;
  MaxRequestSeconds?: number;
  MaxNetworkRetries?: number;
}

export interface AgentModelCapabilitiesConfig {
  Chat?: boolean;
  Embedding?: boolean;
  Rerank?: boolean;
  Vision?: boolean;
  ImageOutput?: boolean;
  Reasoning?: boolean;
  ToolCalling?: boolean;
}

export type AgentModelGroupMatchKind = "exact" | "prefix" | "suffix" | "includes";

export interface AgentModelGroupConfig {
  Id: string;
  Label: string;
  Icon?: string;
  Match?: AgentModelGroupMatchKind;
  Values?: string[];
  Strategies?: AgentModelGroupStrategyConfig[];
}

export interface AgentModelGroupStrategyConfig {
  Match: AgentModelGroupMatchKind;
  Values: string[];
}

export interface AgentModelProviderEndpointConfig {
  Id: string;
  Icon?: string;
  Enabled?: boolean;
  Kind?: "OpenAICompatible";
  BaseUrl?: string;
  ApiKey?: string;
  ApiVersion?: string;
  Headers?: Record<string, string>;
}

export interface ResolvedAgentModelProviderEndpointConfig {
  Id: string;
  Icon: string;
  Enabled: boolean;
  Kind: "OpenAICompatible";
  BaseUrl: string;
  ApiKey: string;
  ApiVersion: string;
  Headers: Record<string, string>;
}

export interface AgentModelRuntimeDefaultsConfig {
  Kind: "OpenAICompatible";
  Endpoint: "Responses" | "ChatCompletions" | "ClaudeMessages" | "GoogleGenerateContent";
  Model: string;
  Capabilities: Required<AgentModelCapabilitiesConfig>;
  ContextWindowTokens: number;
  MaxModelOutputTokens: number;
  Temperature: number;
  MaxOutputTokens: number;
  Stream: boolean;
  TimeoutSeconds: number;
  FirstTokenTimeoutSeconds: number;
  MaxRequestSeconds: number;
  MaxNetworkRetries: number;
}

export interface ResolvedAgentModelProviderConfig {
  Id: string;
  ProviderId: string;
  Icon?: string;
  Capabilities?: AgentModelCapabilitiesConfig;
  ContextWindowTokens?: number;
  MaxModelOutputTokens?: number;
  Kind: "OpenAICompatible";
  Endpoint: "Responses" | "ChatCompletions" | "ClaudeMessages" | "GoogleGenerateContent";
  BaseUrl: string;
  ApiKey: string;
  ApiVersion: string;
  Model: string;
  Temperature: number;
  MaxOutputTokens: number;
  Stream: boolean;
  TimeoutMs: number;
  FirstTokenTimeoutMs: number;
  MaxRequestMs: number;
  MaxNetworkRetries: number;
  Headers: Record<string, string>;
}

export interface AgentModelProviderListItem {
  id: string;
  icon?: string;
  capabilities: Required<AgentModelCapabilitiesConfig>;
  kind: ResolvedAgentModelProviderConfig["Kind"];
  endpoint: ResolvedAgentModelProviderConfig["Endpoint"];
  baseUrl: string;
  model: string;
  isDefault: boolean;
}
