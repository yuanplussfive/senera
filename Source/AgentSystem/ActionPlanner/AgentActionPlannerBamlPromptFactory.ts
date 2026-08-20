import { ClientRegistry } from "@boundaryml/baml";
import { b as baml } from "../BamlClient/baml_client/index.js";
import type { AgentBamlModelRequest } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import type {
  AgentLanguageModelImageAttachment,
  AgentLanguageModelMessage,
} from "../ModelEndpoints/AgentLanguageModel.js";
import {
  type AgentMemoryConsolidationPromptInput,
  type AgentMemoryLearningPromptInput,
  type AgentMemoryWriteResolutionPromptInput,
  type AgentToolLearningPromptInput,
  buildMemoryConsolidationPromptJson,
  buildMemoryLearningPromptJson,
  buildMemoryWriteResolutionPromptJson,
  buildToolLearningPromptJson,
} from "./AgentLearningPromptJson.js";
import type {
  AgentPiControllerDecisionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../PiShared/AgentPiPlanningTypes.js";
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
      functionName: "LearnMemory";
      input: AgentMemoryLearningPromptInput;
    }
  | {
      functionName: "RepairMemoryLearning";
      input: AgentMemoryLearningPromptInput;
      invalidLearning: string;
      issues: string[];
    }
  | {
      functionName: "ConsolidateMemoryCandidates";
      input: AgentMemoryConsolidationPromptInput;
    }
  | {
      functionName: "RepairMemoryConsolidation";
      input: AgentMemoryConsolidationPromptInput;
      invalidConsolidation: string;
      issues: string[];
    }
  | {
      functionName: "ResolveMemoryWrite";
      input: AgentMemoryWriteResolutionPromptInput;
    }
  | {
      functionName: "RepairMemoryWriteResolution";
      input: AgentMemoryWriteResolutionPromptInput;
      invalidResolution: string;
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
    };

export class AgentActionPlannerBamlPromptFactory {
  private readonly promptRegistry = createPromptRegistry();

  async buildPrompt(
    args: AgentActionPlannerBamlFunctionArgs,
    options: { attachments?: readonly AgentLanguageModelImageAttachment[] } = {},
  ): Promise<AgentBamlModelRequest> {
    const request = await this.buildBamlRequest(args);
    const prompt = projectPromptForBamlFunction(args.functionName, request.body.json() as Record<string, unknown>);
    return {
      requestId: `action-planner:${args.functionName}`,
      step: 0,
      systemPrompt: prompt.systemPrompt,
      messages: attachPlannerImages(prompt.messages, options.attachments),
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
      case "LearnMemory":
        return baml.request.LearnMemory(
          buildMemoryLearningPromptJson(args.input, {
            stage: "learnMemory",
          }),
          options,
        );
      case "RepairMemoryLearning":
        return baml.request.RepairMemoryLearning(
          buildMemoryLearningPromptJson(args.input, {
            stage: "repairMemoryLearning",
            invalidLearning: args.invalidLearning,
            issues: args.issues,
          }),
          options,
        );
      case "ConsolidateMemoryCandidates":
        return baml.request.ConsolidateMemoryCandidates(
          buildMemoryConsolidationPromptJson(args.input, {
            stage: "consolidateMemoryCandidates",
          }),
          options,
        );
      case "RepairMemoryConsolidation":
        return baml.request.RepairMemoryConsolidation(
          buildMemoryConsolidationPromptJson(args.input, {
            stage: "repairMemoryConsolidation",
            invalidConsolidation: args.invalidConsolidation,
            issues: args.issues,
          }),
          options,
        );
      case "ResolveMemoryWrite":
        return baml.request.ResolveMemoryWrite(
          buildMemoryWriteResolutionPromptJson(args.input, {
            stage: "resolveMemoryWrite",
          }),
          options,
        );
      case "RepairMemoryWriteResolution":
        return baml.request.RepairMemoryWriteResolution(
          buildMemoryWriteResolutionPromptJson(args.input, {
            stage: "repairMemoryWriteResolution",
            invalidResolution: args.invalidResolution,
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
  return functionName === "SummarizePiConversation" || functionName === "RepairPiConversationSummary"
    ? projectPlainBamlRequestBody(body)
    : projectActionPlannerBamlRequestBody(body);
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

function createPromptRegistry(): ClientRegistry {
  const registry = new ClientRegistry();
  registry.addLlmClient("SeneraActionPlannerPromptBuilder", "openai-generic", {
    base_url: "https://example.invalid/v1",
    model: "prompt-builder",
    temperature: 0,
  });
  registry.setPrimary("SeneraActionPlannerPromptBuilder");
  return registry;
}
