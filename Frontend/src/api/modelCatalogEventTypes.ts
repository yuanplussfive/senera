import type { BackendLocalizedMessage } from "../i18n/backendMessage";
import type { ModelThinkingLevel, ModelThinkingProfile } from "./modelThinkingTypes";
import type { AgentModelCapabilityFlags, AgentModelPlanningRequirements } from "./generatedModelCapabilityContract";

export interface ModelProviderMetadata {
  id: string;
  /** Configured supplier identity; `id` identifies the model configuration. */
  providerId?: string;
  kind: string;
  endpoint: string;
  baseUrl: string;
  model: string;
}

export interface ModelProviderListItem {
  id: string;
  providerId?: string;
  icon?: string;
  capabilities: ModelCapabilitiesData;
  toolPlanningMode: ModelToolPlanningMode;
  stream: boolean;
  kind: string;
  endpoint: string;
  baseUrl: string;
  model: string;
  isDefault: boolean;
  modelsDev?: ModelsDevModelMetadata;
  thinkingLevels?: ModelThinkingLevel[];
  thinkingProfiles?: ModelThinkingProfile[];
  defaultThinkingLevel?: ModelThinkingLevel;
}

export type ModelToolPlanningMode = keyof typeof AgentModelPlanningRequirements;

export interface ModelCapabilitiesData extends AgentModelCapabilityFlags {
  VisionInput?: ModelVisionInputData;
}

/** Per-model image transport limits, supplied by the endpoint owner. */
export interface ModelVisionInputData {
  SupportedMimeTypes?: string[];
  SupportedAnimatedMimeTypes?: string[];
  MaxBytes?: number;
  MaxPixels?: number;
}

export interface ModelListSnapshotData {
  models: ModelProviderListItem[];
  modelsDev?: ModelsDevCatalogStatus;
  defaultModelProviderId: string;
}

export interface ProviderModelInfo {
  id: string;
  ownedBy?: string;
  modelsDev?: ModelsDevModelMetadata;
}

export interface ModelsDevPricing {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelsDevLink {
  label: string;
  url: string;
  type?: string;
}

export interface ModelsDevModelMetadata {
  id: string;
  sourceModelId: string;
  providerId?: string;
  name?: string;
  description?: string;
  family?: string;
  knowledge?: string;
  releaseDate?: string;
  lastUpdated?: string;
  attachment?: boolean;
  reasoning?: boolean;
  toolCall?: boolean;
  structuredOutput?: boolean;
  temperature?: boolean;
  contextLimit?: number;
  inputLimit?: number;
  outputLimit?: number;
  inputModalities: string[];
  outputModalities: string[];
  openWeights?: boolean;
  license?: string;
  pricing?: ModelsDevPricing;
  links?: ModelsDevLink[];
}

export interface ModelsDevCatalogStatus {
  source: "models.dev";
  state: "ready" | "stale" | "unavailable";
  sourceKind: "cache" | "network";
  fetchedAt?: string;
  checkedAt?: string;
  modelCount: number;
  providerCount: number;
  error?: string;
}

export interface ProviderModelsSnapshotData {
  providerId: string;
  baseUrl: string;
  fetchedAt: string;
  source: "cache" | "network";
  modelsDev?: ModelsDevCatalogStatus;
  models: ProviderModelInfo[];
}

export interface ProviderModelsFailedData {
  providerId: string;
  message: string;
  localizedMessage?: BackendLocalizedMessage;
  details?: unknown;
}
