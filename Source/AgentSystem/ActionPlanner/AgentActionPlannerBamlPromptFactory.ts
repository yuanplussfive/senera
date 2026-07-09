import { ClientRegistry } from "@boundaryml/baml";
import { b as baml } from "../BamlClient/baml_client/index.js";
import type { ActionPlanInput } from "../BamlClient/baml_client/types.js";
import type { AgentBamlModelRequest } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import { buildActionPlannerPromptJson } from "./AgentActionPlannerPromptJson.js";
import { projectActionPlannerBamlRequestBody } from "./AgentActionPlannerPromptProjector.js";
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
  AgentPiControllerActionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../PiProxy/AgentPiAssistantMessageTypes.js";
import type { AgentBamlToolRiskAuditPromptInput } from "../Safety/AgentBamlToolRiskAuditPromptJson.js";
import { buildBamlToolRiskAuditPromptJson } from "../Safety/AgentBamlToolRiskAuditPromptJson.js";

export type AgentActionPlannerBamlFunctionArgs =
  | {
      functionName: "UnderstandUserTurn";
      input: ActionPlanInput;
    }
  | {
      functionName: "RepairTurnUnderstanding";
      input: ActionPlanInput;
      invalidUnderstanding: string;
      issues: string[];
    }
  | {
      functionName: "RouteInteraction";
      input: ActionPlanInput;
    }
  | {
      functionName: "RepairInteractionRoute";
      input: ActionPlanInput;
      invalidRoute: string;
      issues: string[];
    }
  | {
      functionName: "SelectPiAction";
      input: AgentPiControllerActionInput;
    }
  | {
      functionName: "RepairPiAction";
      input: AgentPiControllerActionInput;
      invalidAction: string;
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
  ;

export class AgentActionPlannerBamlPromptFactory {
  private readonly promptRegistry = createPromptRegistry();

  async buildPrompt(args: AgentActionPlannerBamlFunctionArgs): Promise<AgentBamlModelRequest> {
    const request = await this.buildBamlRequest(args);
    const prompt = projectPromptForBamlFunction(
      args.functionName,
      request.body.json() as Record<string, unknown>,
    );
    return {
      requestId: `action-planner:${args.functionName}`,
      step: 0,
      systemPrompt: prompt.systemPrompt,
      messages: prompt.messages,
    };
  }

  private buildBamlRequest(args: AgentActionPlannerBamlFunctionArgs) {
    const options = {
      clientRegistry: this.promptRegistry,
    };

    switch (args.functionName) {
      case "UnderstandUserTurn":
        return baml.request.UnderstandUserTurn(
          buildActionPlannerPromptJson(args.input, {
            stage: "understandUserTurn",
          }),
          options,
        );
      case "RepairTurnUnderstanding":
        return baml.request.RepairTurnUnderstanding(
          buildActionPlannerPromptJson(args.input, {
            stage: "repairTurnUnderstanding",
            invalidUnderstanding: args.invalidUnderstanding,
            issues: args.issues,
          }),
          options,
        );
      case "RouteInteraction":
        return baml.request.RouteInteraction(
          buildActionPlannerPromptJson(args.input, {
            stage: "routeInteraction",
          }),
          options,
        );
      case "RepairInteractionRoute":
        return baml.request.RepairInteractionRoute(
          buildActionPlannerPromptJson(args.input, {
            stage: "repairInteractionRoute",
            invalidRoute: args.invalidRoute,
            issues: args.issues,
          }),
          options,
        );
      case "SelectPiAction":
        return baml.request.SelectPiAction(
          buildPiPromptJson(args.input, {
            stage: "selectPiAction",
          }),
          options,
        );
      case "RepairPiAction":
        return baml.request.RepairPiAction(
          buildPiPromptJson(args.input, {
            stage: "repairPiAction",
            invalidAction: args.invalidAction,
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
        return baml.request.AuditToolRisk(
          buildBamlToolRiskAuditPromptJson(args.input),
          options,
        );
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
    }
  }
}

function projectPromptForBamlFunction(
  functionName: AgentActionPlannerBamlFunctionArgs["functionName"],
  body: Record<string, unknown>,
) {
  return projectActionPlannerBamlRequestBody(body);
}

function buildPiPromptJson(
  input: object,
  directive: Record<string, unknown>,
): string {
  return JSON.stringify({
    context: {
      ...input,
    },
    directive,
  }, null, 2);
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
