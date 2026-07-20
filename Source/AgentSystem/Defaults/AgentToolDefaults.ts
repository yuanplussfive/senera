import type {
  AgentVectorEmbeddingConfig,
  AgentVectorRerankConfig,
  AgentSystemConfig,
  ResolvedAgentMemoryLearningConfig,
  ResolvedAgentPresetsConfig,
  ResolvedAgentToolLearningConfig,
  ResolvedAgentToolSearchConfig,
  ResolvedAgentVectorModelsConfig,
} from "../Types/AgentConfigTypes.js";
import { resolveAgentDefaults } from "./AgentDefaultResolver.js";
import { resolveModelProviderConfig, resolveModelProviderEndpointCatalog } from "./AgentModelProviderDefaults.js";
import { mergeActionPlannerClientConfig, resolveActionPlannerClientConfig } from "./AgentPlannerDefaults.js";
import { optionalSecondsToMilliseconds } from "./AgentTimeDefaults.js";

export function resolveToolSearchConfig(config: AgentSystemConfig): ResolvedAgentToolSearchConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    Embedding: {
      ...defaults.ToolSearch.Embedding,
      ...config.ToolSearch?.Embedding,
    },
    Memory: {
      ...defaults.ToolSearch.Memory,
      ...config.ToolSearch?.Memory,
    },
    Ranking: {
      ...defaults.ToolSearch.Ranking,
      ...config.ToolSearch?.Ranking,
    },
    Rerank: {
      ...defaults.ToolSearch.Rerank,
      ...config.ToolSearch?.Rerank,
      FeatureWeights: {
        ...defaults.ToolSearch.Rerank.FeatureWeights,
        ...config.ToolSearch?.Rerank?.FeatureWeights,
      },
    },
  };
}

export function resolveVectorModelsConfig(config: AgentSystemConfig): ResolvedAgentVectorModelsConfig {
  const defaults = resolveAgentDefaults(config);
  const { TimeoutSeconds: embeddingTimeoutSeconds, ...configuredEmbedding } = config.VectorModels?.Embedding ?? {};
  const { TimeoutSeconds: rerankTimeoutSeconds, ...configuredRerank } = config.VectorModels?.Rerank ?? {};
  const embedding = {
    ...defaults.VectorModels.Embedding,
    ...configuredEmbedding,
    TimeoutMs: optionalSecondsToMilliseconds(embeddingTimeoutSeconds) ?? defaults.VectorModels.Embedding.TimeoutMs,
  };
  const rerank = {
    ...defaults.VectorModels.Rerank,
    ...configuredRerank,
    TimeoutMs: optionalSecondsToMilliseconds(rerankTimeoutSeconds) ?? defaults.VectorModels.Rerank.TimeoutMs,
  };
  const endpointCatalog = resolveModelProviderEndpointCatalog(config);
  const embeddingEndpoint = endpointCatalog.resolveKnown(embedding.ProviderId);
  const rerankEndpoint = endpointCatalog.resolveKnown(rerank.ProviderId);

  return {
    Embedding: {
      ...resolveVectorHttpConfig(embedding, embeddingEndpoint),
      Dimensions: embedding.Dimensions,
      BatchSize: embedding.BatchSize,
      InputMaxChars: embedding.InputMaxChars,
    },
    Rerank: {
      ...resolveVectorHttpConfig(rerank, rerankEndpoint),
      EndpointPath: rerank.EndpointPath,
      CandidateLimit: rerank.CandidateLimit,
      TopK: rerank.TopK,
    },
  };
}

export function resolveToolLearningConfig(config: AgentSystemConfig): ResolvedAgentToolLearningConfig {
  const defaults = resolveAgentDefaults(config);
  const provider = resolveModelProviderConfig(config, defaults.ToolLearning.Client.ModelProviderId);
  return {
    ...defaults.ToolLearning,
    ...config.ToolLearning,
    Patterns: {
      ...defaults.ToolLearning.Patterns,
      ...config.ToolLearning?.Patterns,
    },
    Client: resolveActionPlannerClientConfig({
      config,
      baseProvider: provider,
      configuredClient: mergeActionPlannerClientConfig(defaults.ToolLearning.Client, config.ToolLearning?.Client),
    }),
  };
}

export function resolveMemoryLearningConfig(config: AgentSystemConfig): ResolvedAgentMemoryLearningConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    Promotion: {
      ...defaults.MemoryLearning.Promotion,
      ...config.MemoryLearning?.Promotion,
    },
  };
}

export function resolvePresetsConfig(config: AgentSystemConfig): ResolvedAgentPresetsConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.Presets,
    ...config.Presets,
  };
}

function resolveVectorHttpConfig(
  config: (Required<AgentVectorEmbeddingConfig> | Required<AgentVectorRerankConfig>) & { TimeoutMs: number },
  endpoint: ReturnType<typeof resolveModelProviderEndpointCatalog>["endpoints"][number],
) {
  return {
    Enabled: config.Enabled && endpoint.Enabled,
    BaseUrl: endpoint.BaseUrl,
    ApiKey: endpoint.ApiKey,
    Model: config.Model,
    TimeoutMs: config.TimeoutMs,
    MaxNetworkRetries: config.MaxNetworkRetries,
    Headers: { ...endpoint.Headers },
  };
}
