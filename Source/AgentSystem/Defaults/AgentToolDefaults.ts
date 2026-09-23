import type {
  AgentSystemConfig,
  ResolvedAgentContinuityLearningConfig,
  ResolvedAgentPresetsConfig,
  ResolvedAgentToolLearningConfig,
  ResolvedAgentToolSearchConfig,
} from "../Types/AgentConfigTypes.js";
import type { AgentContinuityPromptBudgetConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import { resolveAgentDefaults } from "./AgentDefaultResolver.js";
import { resolveModelProviderConfig } from "./AgentModelProviderDefaults.js";
import { mergeActionPlannerClientConfig, resolveActionPlannerClientConfig } from "./AgentPlannerDefaults.js";
import { mergeAgentContinuityRecallRanking } from "../Continuity/AgentContinuityRecallPolicy.js";

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
  const learningContext = {
    ...defaults.ContinuityLearning.LearningContext,
    ...config.ContinuityLearning?.LearningContext,
  };
  const temporalMemory = {
    ...defaults.ContinuityLearning.TemporalMemory,
    ...config.ContinuityLearning?.TemporalMemory,
  };
  validateContinuityRuntime(runtime);
  validateContinuityLearningContext(learningContext);
  const provider = resolveModelProviderConfig(config, configuredClient.ModelProviderId);
  return {
    ...defaults.ContinuityLearning,
    ...config.ContinuityLearning,
    LearningGate: {
      ...defaults.ContinuityLearning.LearningGate,
      ...config.ContinuityLearning?.LearningGate,
    },
    LearningContext: learningContext,
    TemporalMemory: temporalMemory,
    Recall: {
      ...defaults.ContinuityLearning.Recall,
      ...configuredRecall,
      TurnValueClassifier: {
        ...defaults.ContinuityLearning.Recall.TurnValueClassifier,
        ...configuredRecall?.TurnValueClassifier,
        ConfidenceThreshold:
          configuredRecall?.TurnValueClassifier?.ConfidenceThreshold ??
          defaults.ContinuityLearning.Recall.TurnValueClassifier.ConfidenceThreshold,
        MinimumExamplesPerLabel:
          configuredRecall?.TurnValueClassifier?.MinimumExamplesPerLabel ??
          defaults.ContinuityLearning.Recall.TurnValueClassifier.MinimumExamplesPerLabel,
        MaxTrainingEntries:
          configuredRecall?.TurnValueClassifier?.MaxTrainingEntries ??
          defaults.ContinuityLearning.Recall.TurnValueClassifier.MaxTrainingEntries,
      },
      Prefetch: {
        ...defaults.ContinuityLearning.Recall.Prefetch,
        ...configuredRecall?.Prefetch,
      },
      PromptBudget: resolveContinuityPromptBudget(
        defaults.ContinuityLearning.Recall.PromptBudget,
        configuredRecall?.PromptBudget,
      ),
      Ranking: mergeAgentContinuityRecallRanking(defaults.ContinuityLearning.Recall.Ranking, configuredRecall?.Ranking),
      Semantic: resolveContinuitySemanticRecall(
        defaults.ContinuityLearning.Recall.Semantic,
        configuredRecall?.Semantic,
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

function validateContinuityLearningContext(input: {
  ReferentBudgetCharacters: number;
  CatalogBudgetCharacters: number;
  VerifiedExampleBudgetCharacters: number;
}): void {
  if (!Number.isSafeInteger(input.ReferentBudgetCharacters) || input.ReferentBudgetCharacters < 1) {
    throw new Error("Continuity learning ReferentBudgetCharacters must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(input.VerifiedExampleBudgetCharacters) || input.VerifiedExampleBudgetCharacters < 1) {
    throw new Error("Continuity learning VerifiedExampleBudgetCharacters must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(input.CatalogBudgetCharacters) || input.CatalogBudgetCharacters < 1) {
    throw new Error("Continuity learning CatalogBudgetCharacters must be a positive safe integer.");
  }
}

function resolveContinuitySemanticRecall(
  defaults: ResolvedAgentContinuityLearningConfig["Recall"]["Semantic"],
  configured: Partial<ResolvedAgentContinuityLearningConfig["Recall"]["Semantic"]> | undefined,
): ResolvedAgentContinuityLearningConfig["Recall"]["Semantic"] {
  const semantic = { ...defaults, ...(configured ?? {}) };
  if (semantic.ScoreFloor < 0 || semantic.ScoreFloor > 1) {
    throw new Error("Continuity semantic recall ScoreFloor must be between 0 and 1.");
  }
  if (!Number.isSafeInteger(semantic.TimeoutMs) || semantic.TimeoutMs < 1) {
    throw new Error("Continuity semantic recall TimeoutMs must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(semantic.MinQueryCharacters) || semantic.MinQueryCharacters < 0) {
    throw new Error("Continuity semantic recall MinQueryCharacters must be a non-negative safe integer.");
  }
  return semantic;
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

export function resolvePresetsConfig(config: AgentSystemConfig): ResolvedAgentPresetsConfig {
  const defaults = resolveAgentDefaults(config);
  return {
    ...defaults.Presets,
    ...config.Presets,
    PromptBudget: {
      ...defaults.Presets.PromptBudget,
      ...config.Presets?.PromptBudget,
    },
  };
}
