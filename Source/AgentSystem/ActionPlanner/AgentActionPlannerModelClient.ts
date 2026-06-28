import type {
  ActionPlanInput,
  EvidenceVerification as BamlEvidenceVerification,
  FastContextScoutPlannerDecision as BamlFastContextScoutPlannerDecision,
  InteractionRoute as BamlInteractionRoute,
  MemoryConsolidationResult as BamlMemoryConsolidationResult,
  MemoryLearningResult as BamlMemoryLearningResult,
  MemoryWriteResolutionResult as BamlMemoryWriteResolutionResult,
  TaskFrame as BamlTaskFrame,
  ToolCallPlan as BamlToolCallPlan,
  ToolLearningResult as BamlToolLearningResult,
  TurnUnderstanding as BamlTurnUnderstanding,
} from "../BamlClient/baml_client/types.js";
import type {
  ResolvedAgentActionPlannerClientConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";
import type { AgentFastContextScoutPlannerPromptInput } from "./AgentFastContextScoutPlannerPromptJson.js";
import type { AgentToolCallPlannerPromptInput } from "./AgentToolCallPlannerPromptJson.js";
import type { AgentBamlStructuredOutputTraceSink } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import type {
  AgentMemoryConsolidationPromptInput,
  AgentMemoryLearningPromptInput,
  AgentMemoryWriteResolutionPromptInput,
  AgentToolLearningPromptInput,
} from "./AgentLearningPromptJson.js";
import { AgentActionPlannerModelTransport } from "./AgentActionPlannerModelTransport.js";
import { resolvePlannerProvider } from "./AgentActionPlannerProviderResolver.js";
import { AgentActionPlannerStructuredCaller } from "./AgentActionPlannerStructuredCaller.js";
import { AgentActionPlannerCoreModelCalls } from "./AgentActionPlannerCoreModelCalls.js";
import { AgentActionPlannerLearningModelCalls } from "./AgentActionPlannerLearningModelCalls.js";

export class AgentActionPlannerModelClient {
  readonly providerConfig: ResolvedAgentModelProviderConfig;
  private readonly core: AgentActionPlannerCoreModelCalls;
  private readonly learning: AgentActionPlannerLearningModelCalls;

  constructor(
    model: ResolvedAgentModelProviderConfig,
    overrides: ResolvedAgentActionPlannerClientConfig,
    options: {
      maxRepairAttempts?: number;
      traceSink?: AgentBamlStructuredOutputTraceSink;
    } = {},
  ) {
    this.providerConfig = resolvePlannerProvider(model, overrides);
    const caller = new AgentActionPlannerStructuredCaller(
      new AgentActionPlannerModelTransport(this.providerConfig),
      options,
    );
    this.core = new AgentActionPlannerCoreModelCalls(caller);
    this.learning = new AgentActionPlannerLearningModelCalls(caller);
  }

  buildTaskFrame(
    input: ActionPlanInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlTaskFrame> {
    return this.core.buildTaskFrame(input, options);
  }

  understandUserTurn(
    input: ActionPlanInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlTurnUnderstanding> {
    return this.core.understandUserTurn(input, options);
  }

  routeInteraction(
    input: ActionPlanInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlInteractionRoute> {
    return this.core.routeInteraction(input, options);
  }

  verifyTaskEvidence(options: {
    input: ActionPlanInput;
    taskFrame: BamlTaskFrame;
  }, requestOptions?: { signal?: AbortSignal }): Promise<BamlEvidenceVerification> {
    return this.core.verifyTaskEvidence(options, requestOptions);
  }

  repairTaskFrame(options: {
    input: ActionPlanInput;
    invalidTaskFrame: string;
    issues: string[];
  }, requestOptions?: { signal?: AbortSignal }): Promise<BamlTaskFrame> {
    return this.core.repairTaskFrame(options, requestOptions);
  }

  repairTurnUnderstanding(options: {
    input: ActionPlanInput;
    invalidUnderstanding: string;
    issues: string[];
  }, requestOptions?: { signal?: AbortSignal }): Promise<BamlTurnUnderstanding> {
    return this.core.repairTurnUnderstanding(options, requestOptions);
  }

  planFastContextScout(
    input: AgentFastContextScoutPlannerPromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlFastContextScoutPlannerDecision> {
    return this.core.planFastContextScout(input, options);
  }

  repairFastContextScoutPlan(options: {
    input: AgentFastContextScoutPlannerPromptInput;
    invalidDecision: string;
    issues: string[];
  }, requestOptions?: { signal?: AbortSignal }): Promise<BamlFastContextScoutPlannerDecision> {
    return this.core.repairFastContextScoutPlan(options, requestOptions);
  }

  planToolCalls(
    input: AgentToolCallPlannerPromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlToolCallPlan> {
    return this.core.planToolCalls(input, options);
  }

  repairToolCallPlan(options: {
    input: AgentToolCallPlannerPromptInput;
    invalidPlan: string;
    issues: string[];
  }, requestOptions?: { signal?: AbortSignal }): Promise<BamlToolCallPlan> {
    return this.core.repairToolCallPlan(options, requestOptions);
  }

  learnToolUse(
    input: AgentToolLearningPromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlToolLearningResult> {
    return this.learning.learnToolUse(input, options);
  }

  repairToolLearning(options: {
    input: AgentToolLearningPromptInput;
    invalidLearning: string;
    issues: string[];
  }, requestOptions?: { signal?: AbortSignal }): Promise<BamlToolLearningResult> {
    return this.learning.repairToolLearning(options, requestOptions);
  }

  learnMemory(
    input: AgentMemoryLearningPromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlMemoryLearningResult> {
    return this.learning.learnMemory(input, options);
  }

  repairMemoryLearning(options: {
    input: AgentMemoryLearningPromptInput;
    invalidLearning: string;
    issues: string[];
  }, requestOptions?: { signal?: AbortSignal }): Promise<BamlMemoryLearningResult> {
    return this.learning.repairMemoryLearning(options, requestOptions);
  }

  consolidateMemoryCandidates(
    input: AgentMemoryConsolidationPromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlMemoryConsolidationResult> {
    return this.learning.consolidateMemoryCandidates(input, options);
  }

  repairMemoryConsolidation(options: {
    input: AgentMemoryConsolidationPromptInput;
    invalidConsolidation: string;
    issues: string[];
  }, requestOptions?: { signal?: AbortSignal }): Promise<BamlMemoryConsolidationResult> {
    return this.learning.repairMemoryConsolidation(options, requestOptions);
  }

  resolveMemoryWrite(
    input: AgentMemoryWriteResolutionPromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlMemoryWriteResolutionResult> {
    return this.learning.resolveMemoryWrite(input, options);
  }

  repairMemoryWriteResolution(options: {
    input: AgentMemoryWriteResolutionPromptInput;
    invalidResolution: string;
    issues: string[];
  }, requestOptions?: { signal?: AbortSignal }): Promise<BamlMemoryWriteResolutionResult> {
    return this.learning.repairMemoryWriteResolution(options, requestOptions);
  }
}
