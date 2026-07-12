import type { resolveModelProviderConfig } from "../AgentDefaults.js";

export interface AgentModelProviderMetadata {
  id: string;
  kind: string;
  endpoint: string;
  baseUrl: string;
  model: string;
}

export interface AgentModelUsage {
  source: "local_estimate";
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AgentRunMetadata {
  modelProvider: AgentModelProviderMetadata;
  usage?: AgentModelUsage;
}

export interface AgentConversationEntryMetadata {
  run?: AgentRunMetadata;
}

export interface AgentSessionMetadata {
  lastRun?: AgentRunMetadata;
  title?: string;
}

type ModelProviderConfig = ReturnType<typeof resolveModelProviderConfig>;

export function createModelProviderMetadata(config: ModelProviderConfig): AgentModelProviderMetadata {
  return {
    id: config.Id,
    kind: config.Kind,
    endpoint: config.Endpoint,
    baseUrl: config.BaseUrl,
    model: config.Model,
  };
}
