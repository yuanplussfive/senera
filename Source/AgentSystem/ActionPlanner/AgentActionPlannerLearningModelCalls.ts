import { b as baml } from "../BamlClient/baml_client/index.js";
import type {
  MemoryConsolidationResult as BamlMemoryConsolidationResult,
  MemoryLearningResult as BamlMemoryLearningResult,
  MemoryWriteResolutionResult as BamlMemoryWriteResolutionResult,
  ToolLearningResult as BamlToolLearningResult,
} from "../BamlClient/baml_client/types.js";
import type {
  AgentMemoryConsolidationPromptInput,
  AgentMemoryLearningPromptInput,
  AgentMemoryWriteResolutionPromptInput,
  AgentToolLearningPromptInput,
} from "./AgentLearningPromptJson.js";
import type { AgentActionPlannerStructuredCaller } from "./AgentActionPlannerStructuredCaller.js";

export class AgentActionPlannerLearningModelCalls {
  constructor(private readonly caller: AgentActionPlannerStructuredCaller) {}

  async learnToolUse(
    input: AgentToolLearningPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlToolLearningResult> {
    return this.caller.run({
      functionName: "LearnToolUse",
      args: {
        functionName: "LearnToolUse",
        input,
      },
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
      args: {
        functionName: "RepairToolLearning",
        ...options,
      },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairToolLearning(rawOutput),
    });
  }

  async learnMemory(
    input: AgentMemoryLearningPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlMemoryLearningResult> {
    return this.caller.run({
      functionName: "LearnMemory",
      args: {
        functionName: "LearnMemory",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.LearnMemory(rawOutput),
      repair: (failure) => ({
        functionName: "RepairMemoryLearning",
        input,
        invalidLearning: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairMemoryLearning(
    options: {
      input: AgentMemoryLearningPromptInput;
      invalidLearning: string;
      issues: string[];
    },
    requestOptions: { signal?: AbortSignal } = {},
  ): Promise<BamlMemoryLearningResult> {
    return this.caller.repair({
      functionName: "RepairMemoryLearning",
      args: {
        functionName: "RepairMemoryLearning",
        ...options,
      },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairMemoryLearning(rawOutput),
    });
  }

  async consolidateMemoryCandidates(
    input: AgentMemoryConsolidationPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlMemoryConsolidationResult> {
    return this.caller.run({
      functionName: "ConsolidateMemoryCandidates",
      args: {
        functionName: "ConsolidateMemoryCandidates",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.ConsolidateMemoryCandidates(rawOutput),
      repair: (failure) => ({
        functionName: "RepairMemoryConsolidation",
        input,
        invalidConsolidation: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairMemoryConsolidation(
    options: {
      input: AgentMemoryConsolidationPromptInput;
      invalidConsolidation: string;
      issues: string[];
    },
    requestOptions: { signal?: AbortSignal } = {},
  ): Promise<BamlMemoryConsolidationResult> {
    return this.caller.repair({
      functionName: "RepairMemoryConsolidation",
      args: {
        functionName: "RepairMemoryConsolidation",
        ...options,
      },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairMemoryConsolidation(rawOutput),
    });
  }

  async resolveMemoryWrite(
    input: AgentMemoryWriteResolutionPromptInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<BamlMemoryWriteResolutionResult> {
    return this.caller.run({
      functionName: "ResolveMemoryWrite",
      args: {
        functionName: "ResolveMemoryWrite",
        input,
      },
      signal: options.signal,
      parse: (rawOutput) => baml.parse.ResolveMemoryWrite(rawOutput),
      repair: (failure) => ({
        functionName: "RepairMemoryWriteResolution",
        input,
        invalidResolution: failure.invalidOutput,
        issues: failure.issues,
      }),
    });
  }

  async repairMemoryWriteResolution(
    options: {
      input: AgentMemoryWriteResolutionPromptInput;
      invalidResolution: string;
      issues: string[];
    },
    requestOptions: { signal?: AbortSignal } = {},
  ): Promise<BamlMemoryWriteResolutionResult> {
    return this.caller.repair({
      functionName: "RepairMemoryWriteResolution",
      args: {
        functionName: "RepairMemoryWriteResolution",
        ...options,
      },
      signal: requestOptions.signal,
      parse: (rawOutput) => baml.parse.RepairMemoryWriteResolution(rawOutput),
    });
  }
}
