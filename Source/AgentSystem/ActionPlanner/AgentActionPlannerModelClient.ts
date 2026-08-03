import type {
  MemoryConsolidationResult as BamlMemoryConsolidationResult,
  MemoryLearningResult as BamlMemoryLearningResult,
  MemoryWriteResolutionResult as BamlMemoryWriteResolutionResult,
  ControllerDecision as BamlControllerDecision,
  PiToolArgumentsDraft as BamlPiToolArgumentsDraft,
  ToolRiskAudit as BamlToolRiskAudit,
  ToolLearningResult as BamlToolLearningResult,
  GroundedDigest as BamlGroundedDigest,
} from "../BamlClient/baml_client/types.js";
import type {
  ResolvedAgentActionPlannerClientConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";
import type { AgentBamlStructuredOutputTraceSink } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import type {
  AgentMemoryConsolidationPromptInput,
  AgentMemoryLearningPromptInput,
  AgentMemoryWriteResolutionPromptInput,
  AgentToolLearningPromptInput,
} from "./AgentLearningPromptJson.js";
import type {
  AgentPiControllerDecisionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../PiShared/AgentPiPlanningTypes.js";
import type { AgentBamlToolRiskAuditPromptInput } from "../Safety/AgentBamlToolRiskAuditPromptJson.js";
import { AgentActionPlannerModelTransport } from "./AgentActionPlannerModelTransport.js";
import { resolvePlannerProvider } from "./AgentActionPlannerProviderResolver.js";
import { AgentActionPlannerStructuredCaller } from "./AgentActionPlannerStructuredCaller.js";
import { AgentActionPlannerCoreModelCalls } from "./AgentActionPlannerCoreModelCalls.js";
import { AgentActionPlannerLearningModelCalls } from "./AgentActionPlannerLearningModelCalls.js";
import type { AgentPiToolObservationDigestPromptInput } from "../Pi/AgentPiToolObservationDigestPrompt.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";

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
      usageSink?: AgentModelUsageSink;
      timingSink?: AgentModelTimingSink;
    } = {},
  ) {
    this.providerConfig = resolvePlannerProvider(model, overrides);
    const caller = new AgentActionPlannerStructuredCaller(
      new AgentActionPlannerModelTransport(this.providerConfig, options.usageSink, options.timingSink),
      options,
    );
    this.core = new AgentActionPlannerCoreModelCalls(caller);
    this.learning = new AgentActionPlannerLearningModelCalls(caller);
  }

  evolveTurn(
    input: AgentPiControllerDecisionInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlControllerDecision> {
    return this.core.evolveTurn(input, options);
  }

  repairControllerDecision(
    options: {
      input: AgentPiControllerDecisionInput;
      invalidDecision: string;
      issues: string[];
    },
    requestOptions?: { signal?: AbortSignal },
  ): Promise<BamlControllerDecision> {
    return this.core.repairControllerDecision(options, requestOptions);
  }

  fillPiToolArguments(
    input: AgentPiToolArgumentsInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlPiToolArgumentsDraft> {
    return this.core.fillPiToolArguments(input, options);
  }

  repairPiToolArguments(
    input: AgentPiToolArgumentsRepairInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlPiToolArgumentsDraft> {
    return this.core.repairPiToolArguments(input, options);
  }

  auditToolRisk(
    input: AgentBamlToolRiskAuditPromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlToolRiskAudit> {
    return this.core.auditToolRisk(input, options);
  }

  repairToolRiskAudit(
    options: {
      input: AgentBamlToolRiskAuditPromptInput;
      invalidAudit: string;
      issues: string[];
    },
    requestOptions?: { signal?: AbortSignal },
  ): Promise<BamlToolRiskAudit> {
    return this.core.repairToolRiskAudit(options, requestOptions);
  }

  condenseToolObservations(
    input: AgentPiToolObservationDigestPromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlGroundedDigest> {
    return this.core.condenseToolObservations(input, options);
  }

  repairToolObservationDigest(
    options: {
      input: AgentPiToolObservationDigestPromptInput;
      invalidDigest: string;
      issues: string[];
    },
    requestOptions?: { signal?: AbortSignal },
  ): Promise<BamlGroundedDigest> {
    return this.core.repairToolObservationDigest(options, requestOptions);
  }

  learnToolUse(
    input: AgentToolLearningPromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlToolLearningResult> {
    return this.learning.learnToolUse(input, options);
  }

  repairToolLearning(
    options: {
      input: AgentToolLearningPromptInput;
      invalidLearning: string;
      issues: string[];
    },
    requestOptions?: { signal?: AbortSignal },
  ): Promise<BamlToolLearningResult> {
    return this.learning.repairToolLearning(options, requestOptions);
  }

  learnMemory(
    input: AgentMemoryLearningPromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlMemoryLearningResult> {
    return this.learning.learnMemory(input, options);
  }

  repairMemoryLearning(
    options: {
      input: AgentMemoryLearningPromptInput;
      invalidLearning: string;
      issues: string[];
    },
    requestOptions?: { signal?: AbortSignal },
  ): Promise<BamlMemoryLearningResult> {
    return this.learning.repairMemoryLearning(options, requestOptions);
  }

  consolidateMemoryCandidates(
    input: AgentMemoryConsolidationPromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlMemoryConsolidationResult> {
    return this.learning.consolidateMemoryCandidates(input, options);
  }

  repairMemoryConsolidation(
    options: {
      input: AgentMemoryConsolidationPromptInput;
      invalidConsolidation: string;
      issues: string[];
    },
    requestOptions?: { signal?: AbortSignal },
  ): Promise<BamlMemoryConsolidationResult> {
    return this.learning.repairMemoryConsolidation(options, requestOptions);
  }

  resolveMemoryWrite(
    input: AgentMemoryWriteResolutionPromptInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlMemoryWriteResolutionResult> {
    return this.learning.resolveMemoryWrite(input, options);
  }

  repairMemoryWriteResolution(
    options: {
      input: AgentMemoryWriteResolutionPromptInput;
      invalidResolution: string;
      issues: string[];
    },
    requestOptions?: { signal?: AbortSignal },
  ): Promise<BamlMemoryWriteResolutionResult> {
    return this.learning.repairMemoryWriteResolution(options, requestOptions);
  }
}
