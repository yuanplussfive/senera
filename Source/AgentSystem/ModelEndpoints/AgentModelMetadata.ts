import type { resolveModelProviderConfig } from "../AgentDefaults.js";
import type { AgentModelUsage } from "./AgentModelUsage.js";
import type { AgentPiSessionLifecycleMetadata } from "../Pi/AgentPiSessionLifecycleMetadata.js";
import type { AgentToolAvailabilitySnapshot } from "../ToolRuntime/AgentToolAvailabilitySnapshot.js";
import type { AgentSessionLifecycleMetadata } from "../Session/AgentSessionLifecycleMetadata.js";

export type { AgentModelUsage } from "./AgentModelUsage.js";

export interface AgentModelProviderMetadata {
  id: string;
  kind: string;
  endpoint: string;
  baseUrl: string;
  model: string;
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
  piSession?: AgentPiSessionLifecycleMetadata;
  toolAvailability?: AgentToolAvailabilitySnapshot;
  lifecycle?: AgentSessionLifecycleMetadata;
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
