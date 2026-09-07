import { b as baml } from "../BamlClient/baml_client/index.js";
import type {
  ContinuityCapture as BamlContinuityCapture,
  ContinuityRuleExtractionResult as BamlContinuityRuleExtractionResult,
  ToolLearningResult as BamlToolLearningResult,
} from "../BamlClient/baml_client/types.js";
import type {
  AgentContinuityFactPromptInput,
  AgentContinuityRulePromptInput,
  AgentToolLearningPromptInput,
} from "./AgentLearningPromptJson.js";
import type { AgentActionPlannerStructuredCaller } from "./AgentActionPlannerStructuredCaller.js";
import type { AgentStablePromptInvocationOptions } from "../ModelEndpoints/AgentLanguageModel.js";

export class AgentActionPlannerLearningModelCalls {
  constructor(private readonly caller: AgentActionPlannerStructuredCaller) {}

  async learnToolUse(
    input: AgentToolLearningPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlToolLearningResult> {
    return this.caller.run({
      functionName: "LearnToolUse",
      args: { functionName: "LearnToolUse", input },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.LearnToolUse(rawOutput),
      repair: (failure) => ({
        functionName: "RepairToolLearning",
        input,
        invalidLearning: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairToolLearning(
    options: {
      input: AgentToolLearningPromptInput;
      invalidLearning: string;
      issues: string[];
    },
    requestOptions: { signal?: AbortSignal } = {},
  ): Promise<BamlToolLearningResult> {
    return this.caller.repair({
      functionName: "RepairToolLearning",
      args: { functionName: "RepairToolLearning", ...options },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairToolLearning(rawOutput),
    });
  }

  async extractContinuityFacts(
    input: AgentContinuityFactPromptInput,
    options: AgentStablePromptInvocationOptions,
  ): Promise<BamlContinuityCapture> {
    return this.caller.run({
      functionName: "ExtractContinuityFacts",
      args: { functionName: "ExtractContinuityFacts", input, stablePrompt: options.stableSystemPrompt },
      signal: options.signal,
      cache: options.cache,
      parse: (rawOutput) => baml.parse.ExtractContinuityFacts(rawOutput),
      repair: (failure) => ({
        functionName: "RepairContinuityFacts",
        input,
        stablePrompt: options.stableSystemPrompt,
        invalidExtraction: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairContinuityFacts(
    options: {
      input: AgentContinuityFactPromptInput;
      invalidExtraction: string;
      issues: string[];
    },
    requestOptions: AgentStablePromptInvocationOptions,
  ): Promise<BamlContinuityCapture> {
    return this.caller.repair({
      functionName: "RepairContinuityFacts",
      args: { functionName: "RepairContinuityFacts", ...options, stablePrompt: requestOptions.stableSystemPrompt },
      signal: requestOptions.signal,
      cache: requestOptions.cache,
      parse: (rawOutput) => baml.parse.RepairContinuityFacts(rawOutput),
    });
  }

  async extractContinuityRules(
    input: AgentContinuityRulePromptInput,
    options: AgentStablePromptInvocationOptions,
  ): Promise<BamlContinuityRuleExtractionResult> {
    return this.caller.run({
      functionName: "ExtractContinuityRules",
      args: { functionName: "ExtractContinuityRules", input, stablePrompt: options.stableSystemPrompt },
      signal: options.signal,
      cache: options.cache,
      parse: (rawOutput) => baml.parse.ExtractContinuityRules(rawOutput),
      repair: (failure) => ({
        functionName: "RepairContinuityRules",
        input,
        stablePrompt: options.stableSystemPrompt,
        invalidExtraction: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairContinuityRules(
    options: {
      input: AgentContinuityRulePromptInput;
      invalidExtraction: string;
      issues: string[];
    },
    requestOptions: AgentStablePromptInvocationOptions,
  ): Promise<BamlContinuityRuleExtractionResult> {
    return this.caller.repair({
      functionName: "RepairContinuityRules",
      args: { functionName: "RepairContinuityRules", ...options, stablePrompt: requestOptions.stableSystemPrompt },
      signal: requestOptions.signal,
      cache: requestOptions.cache,
      parse: (rawOutput) => baml.parse.RepairContinuityRules(rawOutput),
    });
  }
}
