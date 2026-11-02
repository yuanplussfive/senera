import type {
  AgentModelEndpointKind,
  AgentModelToolPlanningMode,
} from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { AgentImageGenerationConfiguration } from "../Images/AgentImageGenerationContract.js";
import type { AgentModelsDevModelMetadata, AgentModelsDevPricing } from "../ModelEndpoints/AgentModelsDevCatalog.js";
import type { AgentModelCapabilityFlags } from "../Core/AgentModelCapabilityContract.js";
import type {
  AgentModelThinkingLevel,
  AgentModelThinkingProfile,
  AgentModelThinkingProfileConfig,
} from "../ModelEndpoints/AgentModelThinking.js";

export interface AgentModelProviderConfig {
  ImageGeneration?: AgentImageGenerationConfiguration;
  /** USD per million tokens. Omitted fields inherit the models.dev reference price. */
  Pricing?: AgentModelsDevPricing;
  Id: string;
  ProviderId: string;
  Icon?: string;
  Capabilities?: AgentModelCapabilitiesConfig;
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

export interface AgentModelCapabilitiesConfig extends AgentModelCapabilityFlags {
  /** Model-specific visual-input transport contract. */
  VisionInput?: AgentModelVisionInputConfig;
}

export interface AgentModelVisionInputConfig {
  SupportedMimeTypes?: string[];
  /** Animated formats are never inferred from the static MIME declaration. */
  SupportedAnimatedMimeTypes?: string[];
  MaxBytes?: number;
  MaxPixels?: number;
}

/** Runtime capability shape after model defaults have been resolved. */
export type ResolvedAgentModelCapabilitiesConfig = Required<Omit<AgentModelCapabilitiesConfig, "VisionInput">> & {
  VisionInput: AgentModelVisionInputConfig;
};

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
  Capabilities: ResolvedAgentModelCapabilitiesConfig;
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
  ImageGeneration?: AgentImageGenerationConfiguration;
  Pricing?: AgentModelsDevPricing;
  Id: string;
  ProviderId: string;
  Icon?: string;
  Capabilities?: AgentModelCapabilitiesConfig;
  /** Preserves whether a capability was explicitly declared or inherited. */
  DeclaredCapabilities?: AgentModelCapabilitiesConfig;
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
  capabilities: ResolvedAgentModelCapabilitiesConfig;
  toolPlanningMode: AgentModelToolPlanningMode;
  stream: boolean;
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
