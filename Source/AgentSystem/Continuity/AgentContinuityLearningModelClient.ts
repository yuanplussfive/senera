import { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import type {
  AgentContinuityFactPromptInput,
  AgentContinuityRulePromptInput,
} from "../ActionPlanner/AgentLearningPromptJson.js";
import { supportsNativeToolCalling } from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { ResolvedAgentContinuityLearningConfig } from "../Types/AgentConfigTypes.js";
import type { AgentStablePromptInvocationOptions } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import {
  parseAgentContinuityFactExtraction,
  parseAgentContinuityRuleExtraction,
  type ParsedAgentContinuityFactExtraction,
  type ParsedAgentContinuityRuleExtraction,
} from "./AgentContinuityLearningSchema.js";
import { AgentContinuityNativeExtractionClient } from "./AgentContinuityNativeExtractionClient.js";
import { AgentContinuityNativeRuleClient } from "./AgentContinuityNativeRuleClient.js";
import {
  AgentContinuityExtractionFailure,
  createContinuityExtractionAttemptFailure,
  type AgentContinuityExtractionMode,
  type AgentContinuityExtractionStage,
} from "./AgentContinuityExtractionFailure.js";

interface AgentContinuityBamlClient {
  extractContinuityFacts(
    input: AgentContinuityFactPromptInput,
    options: AgentStablePromptInvocationOptions,
  ): Promise<unknown>;
  extractContinuityRules(
    input: AgentContinuityRulePromptInput,
    options: AgentStablePromptInvocationOptions,
  ): Promise<unknown>;
}

export interface AgentContinuityLearningModelClientOptions {
  readonly configuration: ResolvedAgentContinuityLearningConfig;
  readonly nativeFactClient?: Pick<AgentContinuityNativeExtractionClient, "extract">;
  readonly nativeRuleClient?: Pick<AgentContinuityNativeRuleClient, "extract">;
  readonly bamlClient?: AgentContinuityBamlClient;
  readonly usageSink?: AgentModelUsageSink;
}

/** Runs each learning stage through the protocol selected by the configured model. */
export class AgentContinuityLearningModelClient {
  constructor(private readonly options: AgentContinuityLearningModelClientOptions) {}

  extractFacts(
    input: AgentContinuityFactPromptInput,
    options: AgentStablePromptInvocationOptions,
  ): Promise<ParsedAgentContinuityFactExtraction> {
    return this.extractWithConfiguredMode({
      stage: "facts",
      parse: parseAgentContinuityFactExtraction,
      native: () => this.nativeFactClient().extract(input, options),
      baml: () => this.bamlClient().extractContinuityFacts(input, options),
    });
  }

  extractRules(
    input: AgentContinuityRulePromptInput,
    options: AgentStablePromptInvocationOptions,
  ): Promise<ParsedAgentContinuityRuleExtraction> {
    return this.extractWithConfiguredMode({
      stage: "rules",
      parse: parseAgentContinuityRuleExtraction,
      native: () => this.nativeRuleClient().extract(input, options),
      baml: () => this.bamlClient().extractContinuityRules(input, options),
    });
  }

  private async extractWithConfiguredMode<T>(input: {
    readonly stage: AgentContinuityExtractionStage;
    readonly parse: (value: unknown) => T;
    readonly native: () => Promise<unknown>;
    readonly baml: () => Promise<unknown>;
  }): Promise<T> {
    const mode = this.configuredMode();
    try {
      return input.parse(await (mode === "native" ? input.native() : input.baml()));
    } catch (error) {
      throw new AgentContinuityExtractionFailure(
        input.stage,
        [createContinuityExtractionAttemptFailure(mode, error)],
        error,
      );
    }
  }

  private configuredMode(): AgentContinuityExtractionMode {
    const provider = this.options.configuration.Client.ModelProvider;
    if (provider.ToolPlanningMode === "native") {
      if (provider.Capabilities?.ToolCalling !== true || !supportsNativeToolCalling(provider.Endpoint)) {
        throw new Error(
          `Continuity learning model ${provider.Id} is configured for native tool calling but does not support it.`,
        );
      }
      return "native";
    }
    if (provider.ToolPlanningMode === "baml") return "baml";
    throw new Error(`Unsupported continuity learning tool planning mode: ${String(provider.ToolPlanningMode)}.`);
  }

  private nativeFactClient(): Pick<AgentContinuityNativeExtractionClient, "extract"> {
    return (
      this.options.nativeFactClient ??
      new AgentContinuityNativeExtractionClient(this.options.configuration.Client.ModelProvider, this.options.usageSink)
    );
  }

  private nativeRuleClient(): Pick<AgentContinuityNativeRuleClient, "extract"> {
    return (
      this.options.nativeRuleClient ??
      new AgentContinuityNativeRuleClient(this.options.configuration.Client.ModelProvider, this.options.usageSink)
    );
  }

  private bamlClient(): AgentContinuityBamlClient {
    if (this.options.bamlClient) return this.options.bamlClient;
    const client = this.options.configuration.Client;
    return new AgentActionPlannerModelClient(
      client.ModelProvider,
      { ...client, MaxTokens: -1 },
      { maxRepairAttempts: 0, omitOutputTokenLimit: true, usageSink: this.options.usageSink },
    );
  }
}
