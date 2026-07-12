import type {
  ActionPlanInput,
  InteractionRoute as BamlInteractionRoute,
  MemoryConsolidationResult as BamlMemoryConsolidationResult,
  MemoryLearningResult as BamlMemoryLearningResult,
  MemoryWriteResolutionResult as BamlMemoryWriteResolutionResult,
  PiControllerAction as BamlPiControllerAction,
  PiToolArgumentsDraft as BamlPiToolArgumentsDraft,
  ToolRiskAudit as BamlToolRiskAudit,
  ToolLearningResult as BamlToolLearningResult,
  TurnUnderstanding as BamlTurnUnderstanding,
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
  AgentPiControllerActionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../PiProxy/AgentPiAssistantMessageTypes.js";
import type { AgentBamlToolRiskAuditPromptInput } from "../Safety/AgentBamlToolRiskAuditPromptJson.js";
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

  understandUserTurn(input: ActionPlanInput, options?: { signal?: AbortSignal }): Promise<BamlTurnUnderstanding> {
    return this.core.understandUserTurn(input, options);
  }

  routeInteraction(input: ActionPlanInput, options?: { signal?: AbortSignal }): Promise<BamlInteractionRoute> {
    return this.core.routeInteraction(input, options);
  }

  repairTurnUnderstanding(
    options: {
      input: ActionPlanInput;
      invalidUnderstanding: string;
      issues: string[];
    },
    requestOptions?: { signal?: AbortSignal },
  ): Promise<BamlTurnUnderstanding> {
    return this.core.repairTurnUnderstanding(options, requestOptions);
  }

  selectPiAction(
    input: AgentPiControllerActionInput,
    options?: { signal?: AbortSignal },
  ): Promise<BamlPiControllerAction> {
    return this.core.selectPiAction(input, options);
  }

  repairPiAction(
    options: {
      input: AgentPiControllerActionInput;
      invalidAction: string;
      issues: string[];
    },
    requestOptions?: { signal?: AbortSignal },
  ): Promise<BamlPiControllerAction> {
    return this.core.repairPiAction(options, requestOptions);
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

/** The narrow planner capability required by turn understanding and routing. */
export interface AgentActionPlannerCoreClient {
  understandUserTurn(input: ActionPlanInput, options?: { signal?: AbortSignal }): Promise<BamlTurnUnderstanding>;
  routeInteraction(input: ActionPlanInput, options?: { signal?: AbortSignal }): Promise<BamlInteractionRoute>;
  repairTurnUnderstanding(
    options: {
      input: ActionPlanInput;
      invalidUnderstanding: string;
      issues: string[];
    },
    requestOptions?: { signal?: AbortSignal },
  ): Promise<BamlTurnUnderstanding>;
}
