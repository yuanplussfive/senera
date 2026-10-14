import type {
  AgentSystemConfig,
  ResolvedAgentContinuityLearningConfig,
  ResolvedAgentStateCardConfig,
  ResolvedAgentToolSearchConfig,
} from "../Types/AgentConfigTypes.js";
import type { AgentContinuityPromptBudgetConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import { resolveAgentDefaults } from "./AgentDefaultResolver.js";
import { resolveModelProviderConfig } from "./AgentModelProviderDefaults.js";
import { resolveActionPlannerClientConfig } from "./AgentPlannerDefaults.js";

export function resolveToolSearchConfig(config: AgentSystemConfig): ResolvedAgentToolSearchConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    Fuzzy: {
      ...defaults.ToolSearch.Fuzzy,
      ...config.ToolSearch?.Fuzzy,
    },
    Embedding: {
      ...defaults.ToolSearch.Embedding,
      ...config.ToolSearch?.Embedding,
    },
    Tokenize: {
      ...defaults.ToolSearch.Tokenize,
      ...config.ToolSearch?.Tokenize,
    },
    Memory: {
      ...defaults.ToolSearch.Memory,
      ...config.ToolSearch?.Memory,
    },
    Ranking: {
      ...defaults.ToolSearch.Ranking,
      ...config.ToolSearch?.Ranking,
      ChannelWeights: {
        ...defaults.ToolSearch.Ranking.ChannelWeights,
        ...config.ToolSearch?.Ranking?.ChannelWeights,
      },
    },
    Disclosure: {
      ...defaults.ToolSearch.Disclosure,
      ...config.ToolSearch?.Disclosure,
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

export function resolveStateCardConfig(config: AgentSystemConfig): ResolvedAgentStateCardConfig {
  const defaults = resolveAgentDefaults(config);
  const configuredClient = {
    ...defaults.StateCard.Client,
    ...config.StateCard?.Client,
    MaxTokens: -1,
  };
  const provider = resolveModelProviderConfig(config, configuredClient.ModelProviderId);
  return {
    ...defaults.StateCard,
    ...config.StateCard,
    Client: resolveActionPlannerClientConfig({
      config,
      baseProvider: provider,
      configuredClient,
    }),
    UsesDefaultModel: !configuredClient.ModelProviderId,
  };
}

export function resolveContinuityLearningConfig(config: AgentSystemConfig): ResolvedAgentContinuityLearningConfig {
  const defaults = resolveAgentDefaults(config);
  const configuredRecall = config.ContinuityLearning?.Recall;
  const configuredClient = {
    ...defaults.ContinuityLearning.Client,
    ...config.ContinuityLearning?.Client,
    MaxTokens: -1,
  };
  const runtime = {
    ...defaults.ContinuityLearning.Runtime,
    ...config.ContinuityLearning?.Runtime,
  };
  const memos = {
    ...defaults.ContinuityLearning.MemOS,
    ...config.ContinuityLearning?.MemOS,
  };
  validateContinuityRuntime(runtime);
  validateMemOSConfig(memos);
  const provider = resolveModelProviderConfig(config, configuredClient.ModelProviderId);
  return {
    ...defaults.ContinuityLearning,
    ...config.ContinuityLearning,
    MemOS: memos,
    Recall: {
      ...defaults.ContinuityLearning.Recall,
      ...configuredRecall,
      PromptBudget: resolveContinuityPromptBudget(
        defaults.ContinuityLearning.Recall.PromptBudget,
        configuredRecall?.PromptBudget,
      ),
    },
    Client: resolveActionPlannerClientConfig({
      config,
      baseProvider: provider,
      configuredClient,
    }),
    Runtime: runtime,
    UsesDefaultModel: !configuredClient.ModelProviderId,
  };
}

function validateMemOSConfig(config: {
  AutoLinkThreshold: number;
  RecallDedupeThreshold: number;
  RecallDedupeMaxPairs: number;
  FragmentHistoryTurns: number;
  KnowledgeCandidateLimit: number;
  AssistantPreviewTokens: number;
  DigestInputTokenBudget: number;
  DigestSummaryTokenLimit: number;
}): void {
  const { AutoLinkThreshold, RecallDedupeThreshold, ...integerSettings } = config;
  for (const [name, value] of Object.entries({ AutoLinkThreshold, RecallDedupeThreshold })) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error(`Continuity MemOS ${name} must be a number between 0 and 1.`);
  }
  for (const [name, value] of Object.entries(integerSettings)) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`Continuity MemOS ${name} must be a positive integer.`);
  }
}

function resolveContinuityPromptBudget(
  defaults: ResolvedAgentContinuityLearningConfig["Recall"]["PromptBudget"],
  configured: Partial<AgentContinuityPromptBudgetConfig> | undefined,
): ResolvedAgentContinuityLearningConfig["Recall"]["PromptBudget"] {
  const budget = { ...defaults, ...(configured ?? {}) };
  for (const [name, value] of Object.entries(budget)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Continuity recall prompt budget ${name} must be a positive safe integer.`);
    }
  }
  return budget;
}

function validateContinuityRuntime(runtime: {
  MaxAttempts: number;
  RetryBaseDelaySeconds: number;
  RetryMaxDelaySeconds: number;
  MaxJobsPerDrain: number;
}): void {
  if (!Number.isSafeInteger(runtime.MaxAttempts) || runtime.MaxAttempts < 1) {
    throw new Error("Continuity learning MaxAttempts must be a positive safe integer.");
  }
  if (!Number.isFinite(runtime.RetryBaseDelaySeconds) || runtime.RetryBaseDelaySeconds <= 0) {
    throw new Error("Continuity learning RetryBaseDelaySeconds must be positive.");
  }
  if (!Number.isFinite(runtime.RetryMaxDelaySeconds) || runtime.RetryMaxDelaySeconds <= 0) {
    throw new Error("Continuity learning RetryMaxDelaySeconds must be positive.");
  }
  if (runtime.RetryBaseDelaySeconds > runtime.RetryMaxDelaySeconds) {
    throw new Error("Continuity learning retry base delay cannot exceed the maximum delay.");
  }
  if (!Number.isSafeInteger(runtime.MaxJobsPerDrain) || runtime.MaxJobsPerDrain < 1) {
    throw new Error("Continuity learning MaxJobsPerDrain must be a positive safe integer.");
  }
}
