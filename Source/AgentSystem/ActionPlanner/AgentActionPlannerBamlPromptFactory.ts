import { ClientRegistry } from "@boundaryml/baml";
import { b as baml } from "../BamlClient/baml_client/index.js";
import type { AgentBamlModelRequest } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import type {
  AgentLanguageModelCacheOptions,
  AgentLanguageModelImageAttachment,
  AgentLanguageModelMessage,
} from "../ModelEndpoints/AgentLanguageModel.js";
import {
  type AgentContinuityFactPromptInput,
  type AgentContinuityRulePromptInput,
  type AgentToolLearningPromptInput,
  buildAgentContinuityFactPromptJson,
  buildAgentContinuityRulePromptJson,
  buildToolLearningPromptJson,
} from "./AgentLearningPromptJson.js";
import type {
  AgentPiControllerDecisionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../PiShared/AgentPiPlanningTypes.js";
import type { AgentGoalMicroLoopDecisionInput } from "../Agenda/AgentGoalMicroLoopRuntime.js";
import type { AgentWorldResidentIdleDecisionInput } from "../World/AgentWorldResidentIdleRuntime.js";
import type { AgentBamlToolRiskAuditPromptInput } from "../Safety/AgentBamlToolRiskAuditPromptJson.js";
import { buildBamlToolRiskAuditPromptJson } from "../Safety/AgentBamlToolRiskAuditPromptJson.js";
import { projectActionPlannerBamlRequestBody } from "./AgentActionPlannerPromptProjector.js";
import { projectPlainBamlRequestBody } from "./AgentActionPlannerPromptProjector.js";
import {
  buildAgentPiCompactionPromptJson,
  type AgentPiCompactionPromptInput,
} from "../PiShared/AgentPiCompactionPrompt.js";

export type AgentActionPlannerBamlFunctionArgs =
  | {
      functionName: "EvolveTurn";
      input: AgentPiControllerDecisionInput;
    }
  | {
      functionName: "RepairControllerDecision";
      input: AgentPiControllerDecisionInput;
      invalidDecision: string;
      issues: string[];
    }
  | {
      functionName: "FillPiToolArguments";
      input: AgentPiToolArgumentsInput;
    }
  | {
      functionName: "RepairPiToolArguments";
      input: AgentPiToolArgumentsRepairInput;
    }
  | {
      functionName: "AuditToolRisk";
      input: AgentBamlToolRiskAuditPromptInput;
    }
  | {
      functionName: "RepairToolRiskAudit";
      input: AgentBamlToolRiskAuditPromptInput;
      invalidAudit: string;
      issues: string[];
    }
  | {
      functionName: "LearnToolUse";
      input: AgentToolLearningPromptInput;
    }
  | {
      functionName: "RepairToolLearning";
      input: AgentToolLearningPromptInput;
      invalidLearning: string;
      issues: string[];
    }
  | {
      functionName: "ExtractContinuityFacts";
      input: AgentContinuityFactPromptInput;
      stablePrompt: string;
    }
  | {
      functionName: "RepairContinuityFacts";
      input: AgentContinuityFactPromptInput;
      stablePrompt: string;
      invalidExtraction: string;
      issues: string[];
    }
  | {
      functionName: "ExtractContinuityRules";
      input: AgentContinuityRulePromptInput;
      stablePrompt: string;
    }
  | {
      functionName: "RepairContinuityRules";
      input: AgentContinuityRulePromptInput;
      stablePrompt: string;
      invalidExtraction: string;
      issues: string[];
    }
  | {
      functionName: "SummarizePiConversation";
      input: AgentPiCompactionPromptInput;
    }
  | {
      functionName: "RepairPiConversationSummary";
      input: AgentPiCompactionPromptInput;
      invalidSummary: string;
      issues: string[];
    }
  | {
      functionName: "DecideGoalMicroLoop";
      input: AgentGoalMicroLoopDecisionInput;
    }
  | {
      functionName: "DecideResidentIdle";
      input: AgentWorldResidentIdleDecisionInput;
    };

export class AgentActionPlannerBamlPromptFactory {
  private readonly promptRegistry = createAgentBamlPromptBuilderRegistry();

  async buildPrompt(
    args: AgentActionPlannerBamlFunctionArgs,
    options: {
      attachments?: readonly AgentLanguageModelImageAttachment[];
      cache?: AgentLanguageModelCacheOptions;
    } = {},
  ): Promise<AgentBamlModelRequest> {
    const request = await this.buildBamlRequest(args);
    const prompt = projectPromptForBamlFunction(args.functionName, request.body.json() as Record<string, unknown>);
    return {
      requestId: `action-planner:${args.functionName}`,
      step: 0,
      systemPrompt: prompt.systemPrompt,
      messages: attachPlannerImages(prompt.messages, options.attachments),
      cache: options.cache,
    };
  }

  private buildBamlRequest(args: AgentActionPlannerBamlFunctionArgs) {
    const options = {
      clientRegistry: this.promptRegistry,
    };

    switch (args.functionName) {
      case "EvolveTurn":
        return baml.request.EvolveTurn(
          buildPiPromptJson(args.input, {
            stage: "evolveTurn",
          }),
          options,
        );
      case "RepairControllerDecision":
        return baml.request.RepairControllerDecision(
          buildPiPromptJson(args.input, {
            stage: "repairControllerDecision",
            invalidDecision: args.invalidDecision,
            issues: args.issues,
          }),
          options,
        );
      case "FillPiToolArguments":
        return baml.request.FillPiToolArguments(
          buildPiPromptJson(args.input, {
            stage: "fillPiToolArguments",
          }),
          options,
        );
      case "RepairPiToolArguments":
        return baml.request.RepairPiToolArguments(
          buildPiPromptJson(args.input, {
            stage: "repairPiToolArguments",
            invalidArguments: args.input.invalidArguments,
            issues: args.input.issues,
          }),
          options,
        );
      case "AuditToolRisk":
        return baml.request.AuditToolRisk(buildBamlToolRiskAuditPromptJson(args.input), options);
      case "RepairToolRiskAudit":
        return baml.request.RepairToolRiskAudit(
          buildBamlToolRiskAuditPromptJson(args.input, {
            stage: "repairToolRiskAudit",
            invalidAudit: args.invalidAudit,
            issues: args.issues,
          }),
          options,
        );
      case "LearnToolUse":
        return baml.request.LearnToolUse(
          buildToolLearningPromptJson(args.input, {
            stage: "learnToolUse",
          }),
          options,
        );
      case "RepairToolLearning":
        return baml.request.RepairToolLearning(
          buildToolLearningPromptJson(args.input, {
            stage: "repairToolLearning",
            invalidLearning: args.invalidLearning,
            issues: args.issues,
          }),
          options,
        );
      case "ExtractContinuityFacts":
        return baml.request.ExtractContinuityFacts(
          args.stablePrompt,
          buildAgentContinuityFactPromptJson(args.input, { stage: "extractContinuityFacts" }),
          options,
        );
      case "RepairContinuityFacts":
        return baml.request.RepairContinuityFacts(
          args.stablePrompt,
          buildAgentContinuityFactPromptJson(args.input, {
            stage: "repairContinuityFacts",
            invalidExtraction: args.invalidExtraction,
            issues: args.issues,
          }),
          options,
        );
      case "ExtractContinuityRules":
        return baml.request.ExtractContinuityRules(
          args.stablePrompt,
          buildAgentContinuityRulePromptJson(args.input, { stage: "extractContinuityRules" }),
          options,
        );
      case "RepairContinuityRules":
        return baml.request.RepairContinuityRules(
          args.stablePrompt,
          buildAgentContinuityRulePromptJson(args.input, {
            stage: "repairContinuityRules",
            invalidExtraction: args.invalidExtraction,
            issues: args.issues,
          }),
          options,
        );
      case "SummarizePiConversation":
        return baml.request.SummarizePiConversation(
          buildAgentPiCompactionPromptJson(args.input, { stage: "summarizePiConversation" }),
          options,
        );
      case "RepairPiConversationSummary":
        return baml.request.RepairPiConversationSummary(
          buildAgentPiCompactionPromptJson(args.input, {
            stage: "repairPiConversationSummary",
            invalidSummary: args.invalidSummary,
            issues: args.issues,
          }),
          options,
        );
      case "DecideGoalMicroLoop":
        return baml.request.DecideGoalMicroLoop(buildGoalMicroLoopPromptJson(args.input), options);
      case "DecideResidentIdle":
        return baml.request.DecideResidentIdle(buildResidentIdlePromptJson(args.input), options);
    }
  }
}

function attachPlannerImages(
  messages: readonly AgentLanguageModelMessage[],
  attachments: readonly AgentLanguageModelImageAttachment[] | undefined,
): AgentLanguageModelMessage[] {
  if (!attachments?.length) return [...messages];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    return messages.map((candidate, candidateIndex) =>
      candidateIndex === index
        ? {
            ...candidate,
            attachments: [...(candidate.attachments ?? []), ...attachments],
          }
        : candidate,
    );
  }

  return [...messages];
}

function projectPromptForBamlFunction(
  functionName: AgentActionPlannerBamlFunctionArgs["functionName"],
  body: Record<string, unknown>,
) {
  return isPlainBamlFunction(functionName)
    ? projectPlainBamlRequestBody(body)
    : projectActionPlannerBamlRequestBody(body);
}

function isPlainBamlFunction(functionName: AgentActionPlannerBamlFunctionArgs["functionName"]): boolean {
  return (
    functionName === "ExtractContinuityFacts" ||
    functionName === "RepairContinuityFacts" ||
    functionName === "ExtractContinuityRules" ||
    functionName === "RepairContinuityRules" ||
    functionName === "SummarizePiConversation" ||
    functionName === "RepairPiConversationSummary"
  );
}

function buildPiPromptJson(input: object, directive: Record<string, unknown>): string {
  return JSON.stringify(
    {
      context: {
        ...input,
      },
      directive,
    },
    null,
    2,
  );
}

function buildGoalMicroLoopPromptJson(input: AgentGoalMicroLoopDecisionInput): string {
  return JSON.stringify(
    {
      context: {
        worldId: input.worldId,
        from: input.from.toString(),
        to: input.to.toString(),
        ...(input.allowedToolNames ? { allowedToolNames: [...input.allowedToolNames] } : {}),
        candidates: input.candidates,
        world: {
          id: input.snapshot.world.id,
          name: input.snapshot.world.name,
          time: {
            instant: input.snapshot.time.instant.toString(),
            localDate: input.snapshot.time.localDate,
            localTime: input.snapshot.time.localTime,
            phase: input.snapshot.time.phaseLabel,
          },
          calendar: input.snapshot.calendar,
          resident: input.snapshot.resident,
          commitments: input.snapshot.commitments,
          changedNodeIds: input.snapshot.changedNodeIds,
          timeline: input.snapshot.timeline.slice(0, 16),
        },
      },
      directive: { stage: "decideGoalMicroLoop" },
    },
    null,
    2,
  );
}

function buildResidentIdlePromptJson(input: AgentWorldResidentIdleDecisionInput): string {
  return JSON.stringify(
    {
      context: {
        worldId: input.worldId,
        now: input.now.toString(),
        streak: input.streak,
        world: {
          id: input.snapshot.world.id,
          name: input.snapshot.world.name,
          time: {
            instant: input.snapshot.time.instant.toString(),
            localDate: input.snapshot.time.localDate,
            localTime: input.snapshot.time.localTime,
            phase: input.snapshot.time.phaseLabel,
          },
          calendar: input.snapshot.calendar,
          resident: input.snapshot.resident,
          commitments: input.snapshot.commitments,
          changedNodeIds: input.snapshot.changedNodeIds,
          timeline: input.snapshot.timeline.slice(0, 16),
        },
      },
      directive: { stage: "decideResidentIdle" },
    },
    null,
    2,
  );
}

export function createAgentBamlPromptBuilderRegistry(): ClientRegistry {
  const registry = new ClientRegistry();
  registry.addLlmClient("SeneraActionPlannerPromptBuilder", "openai-generic", {
    base_url: "https://example.invalid/v1",
    model: "prompt-builder",
    temperature: 0,
  });
  registry.setPrimary("SeneraActionPlannerPromptBuilder");
  return registry;
}
