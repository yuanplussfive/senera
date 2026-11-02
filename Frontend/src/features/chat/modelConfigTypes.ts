import type {
  ConfigFormFieldData,
  ConfigFormSectionData,
  ModelThinkingLevel,
  ModelThinkingProfileConfig,
  ModelToolPlanningMode,
  ModelsDevPricing,
  ProviderModelEndpointInput,
  ProviderModelInfo,
} from "../../api/eventTypes";
import type { ModelProviderRuleMatchKind } from "../../shared/models/ModelProviderIcon";
import type {
  AgentModelCapabilityFlags,
  AgentImageGenerationConfiguration,
} from "../../api/generatedModelCapabilityContract";

export interface ProviderEndpointDraft {
  Id: string;
  Icon?: string;
  Kind?: string;
  Enabled?: boolean;
  DefaultEndpoint?: ProviderModelEndpointInput["DefaultEndpoint"];
  BaseUrl?: string;
  ApiKey?: string;
  ApiVersion?: string;
  Headers?: Record<string, string>;
}

export interface ModelProviderDraft {
  ImageGeneration?: AgentImageGenerationConfiguration;
  Pricing?: ModelsDevPricing;
  Id: string;
  ProviderId: string;
  Icon?: string;
  Capabilities?: ModelCapabilitiesDraft;
  ThinkingProfiles?: ModelThinkingProfileConfig[];
  DefaultThinkingLevel?: ModelThinkingLevel;
  ToolPlanningMode?: ModelToolPlanningMode;
  ContextWindowTokens?: number;
  MaxModelOutputTokens?: number;
  Endpoint: string;
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

export interface ModelCapabilitiesDraft extends AgentModelCapabilityFlags {
  VisionInput?: ModelVisionInputDraft;
}

export interface ModelVisionInputDraft {
  SupportedMimeTypes?: string[];
  SupportedAnimatedMimeTypes?: string[];
  MaxBytes?: number;
  MaxPixels?: number;
}

export type ResolvedModelCapabilitiesDraft = Required<Omit<ModelCapabilitiesDraft, "VisionInput">> &
  Pick<ModelCapabilitiesDraft, "VisionInput">;

export type ModelBooleanCapabilityKey = Exclude<keyof ModelCapabilitiesDraft, "VisionInput">;

export interface ModelGroupDraft {
  Id: string;
  Label: string;
  Icon?: string;
  Strategies: ModelGroupStrategyDraft[];
}

export interface ModelGroupStrategyDraft {
  Match: ModelProviderRuleMatchKind;
  Values: string[];
}

export interface ProviderModelGroup {
  id: string;
  label: string;
  icon?: string;
  rows: ProviderModelInfo[];
}

export type ModelConfigLayoutMode = "panel" | "embedded";

export type {
  ConfigFormFieldData,
  ConfigFormSectionData,
  ModelToolPlanningMode,
  ProviderModelEndpointInput,
  ProviderModelInfo,
};
