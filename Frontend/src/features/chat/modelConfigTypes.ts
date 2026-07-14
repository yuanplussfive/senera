import type {
  ConfigFormFieldData,
  ConfigFormSectionData,
  ProviderModelEndpointInput,
  ProviderModelInfo,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
} from "../../api/eventTypes";
import type { JsonConfigObject } from "../../shared/config/JsonConfigForm";
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
}

export interface ModelOptionsState {
  model: ModelProviderDraft;
  index: number | null;
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

export interface ModelConfigViewProps {
  value: JsonConfigObject;
  section?: ConfigFormSectionData;
  disabled?: boolean;
  layoutMode?: ModelConfigLayoutMode;
  catalogs: Record<string, ProviderModelsSnapshotData>;
  errors: Record<string, ProviderModelsFailedData & { updatedAt: string }>;
  loadingProviderIds: Record<string, boolean>;
  onFetchProviderModels: (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput) => void;
  onChange: (value: JsonConfigObject) => void;
}

export type { ConfigFormFieldData, ConfigFormSectionData, ProviderModelEndpointInput, ProviderModelInfo };
