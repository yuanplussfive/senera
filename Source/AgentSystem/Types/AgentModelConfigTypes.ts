import type {
  AgentModelEndpointKind,
  AgentModelToolPlanningMode,
} from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { AgentModelsDevModelMetadata } from "../ModelEndpoints/AgentModelsDevCatalog.js";
import type {
  AgentModelThinkingLevel,
  AgentModelThinkingProfile,
  AgentModelThinkingProfileConfig,
} from "../ModelEndpoints/AgentModelThinking.js";
import type { ThinkingLevelMap } from "@earendil-works/pi-ai";

export interface AgentModelProviderConfig {
  Id: string;
  ProviderId: string;
  Icon?: string;
  Capabilities?: AgentModelCapabilitiesConfig;
  /** Explicit Pi-level overrides. Missing values come from Pi model metadata. */
  ThinkingLevelMap?: ThinkingLevelMap;
  ThinkingProfiles?: AgentModelThinkingProfileConfig[];
  DefaultThinkingLevel?: AgentModelThinkingLevel;
  ToolPlanningMode?: AgentModelToolPlanningMode;
  ContextWindowTokens?: number;
  MaxModelOutputTokens?: number;
  Endpoint: AgentModelEndpointKind;
  Model: string;
  Temperature?: number;
  MaxOutputTokens?: number;
  Stream?: boolean;
  TimeoutSeconds?: number;
  FirstTokenTimeoutSeconds?: number;
  MaxRequestSeconds?: number;
  MaxNetworkRetries?: number;
  RetryBaseDelaySeconds?: number;
  RetryMaxDelaySeconds?: number;
  RetryAfterMaxDelaySeconds?: number;
  MaxResponseBytes?: number;
  MaxSseEventBytes?: number;
  MaxSseEvents?: number;
}

export interface AgentModelCapabilitiesConfig {
  Chat?: boolean;
  Embedding?: boolean;
  Rerank?: boolean;
  Vision?: boolean;
  ImageOutput?: boolean;
  Reasoning?: boolean;
  DeveloperRole?: boolean;
  StreamingUsage?: boolean;
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
  /** Protocol used when a new model is created for this provider. */
  DefaultEndpoint?: AgentModelEndpointKind;
  BaseUrl?: string;
  ApiKey?: string;
  ApiVersion?: string;
  Headers?: Record<string, string>;
  /** Groups endpoints behind one provider; defaults to `Id` for compatibility. */
  ProviderId?: string;
  /** Lower value wins. Stable fallback order for `EndpointPool`. Defaults to 0. */
  Priority?: number;
}

export interface ResolvedAgentModelProviderEndpointConfig {
  Id: string;
  Icon: string;
  Enabled: boolean;
  Kind: "OpenAICompatible";
  DefaultEndpoint?: AgentModelEndpointKind;
  BaseUrl: string;
  ApiKey: string;
  ApiVersion: string;
  Headers: Record<string, string>;
  ProviderId: string;
  Priority: number;
}

export interface AgentModelRuntimeDefaultsConfig {
  Kind: "OpenAICompatible";
  Endpoint: AgentModelEndpointKind;
  Model: string;
  Capabilities: Required<AgentModelCapabilitiesConfig>;
  ToolPlanningMode: AgentModelToolPlanningMode;
  ContextWindowTokens: number;
  MaxModelOutputTokens: number;
  Temperature: number;
  MaxOutputTokens: number;
  Stream: boolean;
  TimeoutSeconds: number;
  FirstTokenTimeoutSeconds: number;
  MaxRequestSeconds: number;
  MaxNetworkRetries: number;
  RetryBaseDelaySeconds: number;
  RetryMaxDelaySeconds: number;
  RetryAfterMaxDelaySeconds: number;
  MaxResponseBytes: number;
  MaxSseEventBytes: number;
  MaxSseEvents: number;
}

export interface ResolvedAgentModelProviderConfig {
  Id: string;
  ProviderId: string;
  Icon?: string;
  Capabilities?: AgentModelCapabilitiesConfig;
  /** Preserves whether a capability was explicitly declared or inherited. */
  DeclaredCapabilities?: AgentModelCapabilitiesConfig;
  ThinkingLevelMap?: ThinkingLevelMap;
  ThinkingProfiles?: AgentModelThinkingProfileConfig[];
  DefaultThinkingLevel?: AgentModelThinkingLevel;
  ToolPlanningMode: AgentModelToolPlanningMode;
  ContextWindowTokens: number;
  MaxModelOutputTokens?: number;
  Kind: "OpenAICompatible";
  Endpoint: AgentModelEndpointKind;
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
  RetryBaseDelayMs: number;
  RetryMaxDelayMs: number;
  RetryAfterMaxDelayMs: number;
  MaxResponseBytes?: number;
  MaxSseEventBytes?: number;
  MaxSseEvents?: number;
  Headers: Record<string, string>;
  /** Ordered endpoint candidates for this provider: index 0 is primary, the
   * rest are failover targets used when the primary exhausts its retries.
   * Always populated by the resolver; optional only for hand-built fixtures. */
  EndpointPool?: readonly ResolvedAgentModelProviderEndpointConfig[];
}

export interface AgentModelProviderListItem {
  id: string;
  providerId: string;
  icon?: string;
  capabilities: Required<AgentModelCapabilitiesConfig>;
  kind: ResolvedAgentModelProviderConfig["Kind"];
  endpoint: ResolvedAgentModelProviderConfig["Endpoint"];
  baseUrl: string;
  model: string;
  isDefault: boolean;
  modelsDev?: AgentModelsDevModelMetadata;
  thinkingLevels?: AgentModelThinkingLevel[];
  thinkingProfiles?: AgentModelThinkingProfile[];
  defaultThinkingLevel?: AgentModelThinkingLevel;
}
