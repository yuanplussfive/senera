import type {
  ContinuityCapture as BamlContinuityCapture,
  ContinuityRuleExtractionResult as BamlContinuityRuleExtractionResult,
  ControllerDecision as BamlControllerDecision,
  GoalMicroLoopDecision as BamlGoalMicroLoopDecision,
  ResidentIdleDecision as BamlResidentIdleDecision,
  PiToolArgumentsDraft as BamlPiToolArgumentsDraft,
  ToolRiskAudit as BamlToolRiskAudit,
  ToolLearningResult as BamlToolLearningResult,
  PiConversationSummary as BamlPiConversationSummary,
} from "../BamlClient/baml_client/types.js";
import type {
  ResolvedAgentActionPlannerClientConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";
import type { AgentBamlStructuredOutputTraceSink } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import type {
  AgentContinuityFactPromptInput,
  AgentContinuityRulePromptInput,
  AgentToolLearningPromptInput,
} from "./AgentLearningPromptJson.js";
import type {
  AgentPiControllerDecisionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../PiShared/AgentPiPlanningTypes.js";
import type { AgentGoalMicroLoopDecisionInput } from "../Agenda/AgentGoalMicroLoopRuntime.js";
import type { AgentWorldResidentIdleDecisionInput } from "../World/AgentWorldResidentIdleRuntime.js";
import type { AgentBamlToolRiskAuditPromptInput } from "../Safety/AgentBamlToolRiskAuditPromptJson.js";
import { AgentActionPlannerModelTransport } from "./AgentActionPlannerModelTransport.js";
import { resolvePlannerProvider } from "./AgentActionPlannerProviderResolver.js";
import { AgentActionPlannerStructuredCaller } from "./AgentActionPlannerStructuredCaller.js";
import { AgentActionPlannerCoreModelCalls } from "./AgentActionPlannerCoreModelCalls.js";
import { AgentActionPlannerLearningModelCalls } from "./AgentActionPlannerLearningModelCalls.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import type { AgentPiCompactionPromptInput } from "../PiShared/AgentPiCompactionPrompt.js";
import type {
  AgentLanguageModelInvocationOptions,
  AgentStablePromptInvocationOptions,
} from "../ModelEndpoints/AgentLanguageModel.js";

export class AgentActionPlannerModelClient {
  readonly providerConfig: ResolvedAgentModelProviderConfig;
  readonly supportsVisualInput: boolean;
  private readonly core: AgentActionPlannerCoreModelCalls;
  private readonly learning: AgentActionPlannerLearningModelCalls;

  constructor(
    _model: ResolvedAgentModelProviderConfig,
    overrides: ResolvedAgentActionPlannerClientConfig,
    options: {
      maxRepairAttempts?: number;
      omitOutputTokenLimit?: boolean;
      traceSink?: AgentBamlStructuredOutputTraceSink;
      usageSink?: AgentModelUsageSink;
      timingSink?: AgentModelTimingSink;
    } = {},
  ) {
    this.providerConfig = resolvePlannerProvider(overrides);
    this.supportsVisualInput = this.providerConfig.Capabilities?.Vision === true;
    const caller = new AgentActionPlannerStructuredCaller(
      new AgentActionPlannerModelTransport(this.providerConfig, options.usageSink, options.timingSink, {
        omitOutputTokenLimit: options.omitOutputTokenLimit,
      }),
      options,
    );
    this.core = new AgentActionPlannerCoreModelCalls(caller);
    this.learning = new AgentActionPlannerLearningModelCalls(caller);
  }

  evolveTurn(
    input: AgentPiControllerDecisionInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlControllerDecision> {
    return this.core.evolveTurn(input, options);
  }

  decideGoalMicroLoop(
    input: AgentGoalMicroLoopDecisionInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlGoalMicroLoopDecision[]> {
    return this.core.decideGoalMicroLoop(input, options);
  }

  decideResidentIdle(
    input: AgentWorldResidentIdleDecisionInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlResidentIdleDecision> {
    return this.core.decideResidentIdle(input, options);
  }

  repairControllerDecision(
    options: {
      input: AgentPiControllerDecisionInput;
      invalidDecision: string;
      issues: string[];
    },
    requestOptions?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlControllerDecision> {
    return this.core.repairControllerDecision(options, requestOptions);
  }

  fillPiToolArguments(
    input: AgentPiToolArgumentsInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlPiToolArgumentsDraft> {
    return this.core.fillPiToolArguments(input, options);
  }

  repairPiToolArguments(
    input: AgentPiToolArgumentsRepairInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlPiToolArgumentsDraft> {
    return this.core.repairPiToolArguments(input, options);
  }

  auditToolRisk(
    input: AgentBamlToolRiskAuditPromptInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlToolRiskAudit> {
    return this.core.auditToolRisk(input, options);
  }

  repairToolRiskAudit(
    options: {
      input: AgentBamlToolRiskAuditPromptInput;
      invalidAudit: string;
      issues: string[];
    },
    requestOptions?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlToolRiskAudit> {
    return this.core.repairToolRiskAudit(options, requestOptions);
  }

  summarizePiConversation(
    input: AgentPiCompactionPromptInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlPiConversationSummary> {
    return this.core.summarizePiConversation(input, options);
  }

  repairPiConversationSummary(
    options: {
      input: AgentPiCompactionPromptInput;
      invalidSummary: string;
      issues: string[];
    },
    requestOptions?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlPiConversationSummary> {
    return this.core.repairPiConversationSummary(options, requestOptions);
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

  extractContinuityFacts(
    input: AgentContinuityFactPromptInput,
    options: AgentStablePromptInvocationOptions,
  ): Promise<BamlContinuityCapture> {
    return this.learning.extractContinuityFacts(input, options);
  }

  repairContinuityFacts(
    options: { input: AgentContinuityFactPromptInput; invalidExtraction: string; issues: string[] },
    requestOptions: AgentStablePromptInvocationOptions,
  ): Promise<BamlContinuityCapture> {
    return this.learning.repairContinuityFacts(options, requestOptions);
  }

  extractContinuityRules(
    input: AgentContinuityRulePromptInput,
    options: AgentStablePromptInvocationOptions,
  ): Promise<BamlContinuityRuleExtractionResult> {
    return this.learning.extractContinuityRules(input, options);
  }

  repairContinuityRules(
    options: { input: AgentContinuityRulePromptInput; invalidExtraction: string; issues: string[] },
    requestOptions: AgentStablePromptInvocationOptions,
  ): Promise<BamlContinuityRuleExtractionResult> {
    return this.learning.repairContinuityRules(options, requestOptions);
  }
}
