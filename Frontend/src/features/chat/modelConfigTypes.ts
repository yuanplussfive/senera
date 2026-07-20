import type {
  ConfigFormFieldData,
  ConfigFormSectionData,
  ProviderModelEndpointInput,
  ProviderModelInfo,
} from "../../api/eventTypes";
import type { ModelProviderRuleMatchKind } from "./ModelProviderIcon";

export interface ProviderEndpointDraft {
  Id: string;
  Icon?: string;
  Enabled?: boolean;
  Kind?: string;
  BaseUrl?: string;
  ApiKey?: string;
  ApiVersion?: string;
  Headers?: Record<string, string>;
}

export interface ModelProviderDraft {
  Id: string;
  ProviderId: string;
  Icon?: string;
  Capabilities?: ModelCapabilitiesDraft;
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
}

export interface ModelCapabilitiesDraft {
  Chat?: boolean;
  Embedding?: boolean;
  Rerank?: boolean;
  Vision?: boolean;
  ImageOutput?: boolean;
  Reasoning?: boolean;
  DeveloperRole?: boolean;
  StreamingUsage?: boolean;
}

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

export type { ConfigFormFieldData, ConfigFormSectionData, ProviderModelEndpointInput, ProviderModelInfo };
