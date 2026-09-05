import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentStablePromptInvocationOptions } from "../ModelEndpoints/AgentLanguageModel.js";
import type { ResolvedAgentContinuityLearningConfig } from "../Types/AgentConfigTypes.js";
import type {
  AgentContinuityFactPromptInput,
  AgentContinuityRulePromptInput,
} from "../ActionPlanner/AgentLearningPromptJson.js";
import type { AgentContinuityIdentityContext } from "./AgentContinuityIdentityStore.js";
import {
  agentContinuityLearningFeatureKeys,
  AgentContinuityLearningPromptBundleRegistry,
  createAgentContinuityLearningCacheScope,
  createAgentContinuityLearningInferenceKey,
  type AgentContinuityLearningPromptBundle,
} from "./AgentContinuityLearningPromptBundle.js";
import {
  parseAgentContinuityFactExtraction,
  parseAgentContinuityRuleExtraction,
  type ParsedAgentContinuityFactExtraction,
  type ParsedAgentContinuityRuleExtraction,
} from "./AgentContinuityLearningSchema.js";
import type { AgentContinuitySqliteStore } from "./AgentContinuitySqliteStore.js";
import type { AgentContinuityLearningStage } from "./AgentContinuitySqliteTypes.js";
import { AgentLongLivedCacheRetention } from "../ModelEndpoints/AgentModelCacheScope.js";
import {
  AgentInferenceBudgetExceededError,
  AgentInferenceLaneIds,
  estimateAgentInferenceTokens,
  type AgentInferenceBudgetPort,
} from "../ModelEndpoints/AgentInferenceBudget.js";
import {
  AgentModelUsageLedger,
  type AgentModelUsageValue,
  withAgentModelUsageLedger,
} from "../ModelEndpoints/AgentModelUsage.js";

const ContinuityProviderCacheRetention = AgentLongLivedCacheRetention;

export interface AgentContinuityLearningInferenceExecution<TInput, TOutput> {
  readonly stage: AgentContinuityLearningStage;
  readonly input: TInput;
  readonly output: TOutput;
  readonly bundle: AgentContinuityLearningPromptBundle;
  readonly inferenceKey: string;
  readonly providerId: string;
  readonly model: string;
  readonly cacheHit: boolean;
  readonly usage?: AgentModelUsageValue;
}

/** Coordinates frozen prompt bundles, provider cache affinity, and exact accepted-result reuse. */
export class AgentContinuityLearningInferenceRuntime {
  private readonly bundles: AgentContinuityLearningPromptBundleRegistry;

  constructor(
    private readonly options: {
      readonly store: AgentContinuitySqliteStore;
      readonly identity: AgentContinuityIdentityContext;
      readonly logger?: AgentLogger;
      readonly inferenceBudget?: AgentInferenceBudgetPort;
    },
  ) {
    this.bundles = new AgentContinuityLearningPromptBundleRegistry(options.store);
  }

  extractFacts(input: {
    readonly promptInput: AgentContinuityFactPromptInput;
    readonly configuration: ResolvedAgentContinuityLearningConfig;
    readonly signal: AbortSignal;
    readonly nowMs: number;
    readonly invoke: (
      promptInput: AgentContinuityFactPromptInput,
      options: AgentStablePromptInvocationOptions,
    ) => Promise<ParsedAgentContinuityFactExtraction>;
  }): Promise<
    AgentContinuityLearningInferenceExecution<AgentContinuityFactPromptInput, ParsedAgentContinuityFactExtraction>
  > {
    return this.extract({
      ...input,
      stage: "facts",
      parse: parseAgentContinuityFactExtraction,
    });
  }

  extractRules(input: {
    readonly promptInput: AgentContinuityRulePromptInput;
    readonly configuration: ResolvedAgentContinuityLearningConfig;
    readonly signal: AbortSignal;
    readonly nowMs: number;
    readonly invoke: (
      promptInput: AgentContinuityRulePromptInput,
      options: AgentStablePromptInvocationOptions,
    ) => Promise<ParsedAgentContinuityRuleExtraction>;
  }): Promise<
    AgentContinuityLearningInferenceExecution<AgentContinuityRulePromptInput, ParsedAgentContinuityRuleExtraction>
  > {
    return this.extract({
      ...input,
      stage: "rules",
      parse: parseAgentContinuityRuleExtraction,
    });
  }

  record<TInput, TOutput>(
    execution: AgentContinuityLearningInferenceExecution<TInput, TOutput>,
    sourceEpisodeUri: string,
    acceptedItemCount: number,
    observedAtMs: number,
  ): void {
    this.options.store.recordLearningInference({
      inferenceKey: execution.inferenceKey,
      stage: execution.stage,
      contractRevision: execution.bundle.contractRevision,
      bundleRevision: execution.bundle.revision,
      providerId: execution.providerId,
      model: execution.model,
      inputJson: stringifyAgentCanonicalJson(execution.input),
      outputJson: stringifyAgentCanonicalJson(execution.output),
      featureKeys: agentContinuityLearningFeatureKeys(execution.stage, execution.output),
      acceptedItemCount,
      sourceEpisodeUri,
      observedAtMs,
    });
    this.options.logger?.info("continuity.learning.inference_recorded", {
      episodeUri: sourceEpisodeUri,
      stage: execution.stage,
      inferenceKey: execution.inferenceKey,
      acceptedItemCount,
      bundleRevision: execution.bundle.revision,
    });
  }

  private async extract<TInput, TOutput>(input: {
    readonly stage: AgentContinuityLearningStage;
    readonly promptInput: TInput;
    readonly configuration: ResolvedAgentContinuityLearningConfig;
    readonly signal: AbortSignal;
    readonly nowMs: number;
    readonly parse: (value: unknown) => TOutput;
    readonly invoke: (promptInput: TInput, options: AgentStablePromptInvocationOptions) => Promise<TOutput>;
  }): Promise<AgentContinuityLearningInferenceExecution<TInput, TOutput>> {
    const provider = input.configuration.Client.ModelProvider;
    const bundle = this.bundles.get(input.stage, input.configuration.LearningContext.VerifiedExampleBudgetCharacters);
    const inferenceKey = createAgentContinuityLearningInferenceKey({
      stage: input.stage,
      contractRevision: bundle.contractRevision,
      provider,
      promptInput: input.promptInput,
    });
    const cached = this.options.store.readLearningInference(inferenceKey, input.nowMs);
    if (cached) {
      const output = input.parse(JSON.parse(cached.outputJson));
      this.options.logger?.info("continuity.learning.inference_cache_hit", {
        stage: input.stage,
        inferenceKey,
        bundleRevision: bundle.revision,
      });
      return {
        stage: input.stage,
        input: input.promptInput,
        output,
        bundle,
        inferenceKey,
        providerId: provider.Id,
        model: provider.Model,
        cacheHit: true,
      };
    }
    this.options.logger?.info("continuity.learning.inference_cache_miss", {
      stage: input.stage,
      inferenceKey,
      bundleRevision: bundle.revision,
      demonstrations: bundle.demonstrationKeys.length,
    });
    const budget = this.options.inferenceBudget;
    let reservationId: string | undefined;
    const reservedInputTokens = estimateAgentInferenceTokens(input.promptInput);
    if (budget) {
      const decision = budget.reserve({
        scope: this.options.identity.workspaceId,
        lane: AgentInferenceLaneIds.Continuity,
        sourceId: "continuity.learning",
        requestId: inferenceKey,
        estimatedInputTokens: reservedInputTokens,
      });
      if (!decision.allowed) {
        if (decision.retryAtMs === undefined || decision.reason === undefined) {
          throw new Error("Inference budget returned a denied decision without retry metadata.");
        }
        throw new AgentInferenceBudgetExceededError(decision.retryAtMs, decision.reason);
      }
      reservationId = decision.reservation?.id;
      if (!reservationId) throw new Error("Inference budget allowed a request without a reservation.");
    }
    let output: TOutput | undefined;
    let usage: AgentModelUsageValue | undefined;
    try {
      const usageLedger = new AgentModelUsageLedger();
      output = await withAgentModelUsageLedger(usageLedger, () =>
        input.invoke(input.promptInput, {
          signal: input.signal,
          stableSystemPrompt: bundle.systemPrompt,
          cache: {
            scope: createAgentContinuityLearningCacheScope({ identity: this.options.identity, provider, bundle }),
            retention: ContinuityProviderCacheRetention,
          },
        }),
      );
      usage = usageLedger.aggregate();
    } finally {
      if (reservationId) {
        budget?.settle({
          reservationId,
          actualInputTokens: usage?.inputTokens ?? reservedInputTokens,
          ...(usage?.outputTokens !== undefined
            ? { actualOutputTokens: usage.outputTokens }
            : output !== undefined
              ? { actualOutputTokens: estimateAgentInferenceTokens(output) }
              : {}),
        });
      }
    }
    if (output === undefined) throw new Error("Continuity learning inference returned no output.");
    return {
      stage: input.stage,
      input: input.promptInput,
      output,
      bundle,
      inferenceKey,
      providerId: provider.Id,
      model: provider.Model,
      cacheHit: false,
      ...(usage ? { usage } : {}),
    };
  }
}
