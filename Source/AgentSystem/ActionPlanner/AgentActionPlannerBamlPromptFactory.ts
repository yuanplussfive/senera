import { ClientRegistry } from "@boundaryml/baml";
import { b as baml } from "../BamlClient/baml_client/index.js";
import type {
  ActionPlanInput,
  TaskFrame as BamlTaskFrame,
} from "../BamlClient/baml_client/types.js";
import type { AgentBamlModelRequest } from "../AgentBamlStructuredOutputRunner.js";
import type { AgentFastContextScoutPlannerPromptInput } from "../AgentFastContextScoutPlannerPromptJson.js";
import { buildFastContextScoutPromptJson } from "../AgentFastContextScoutPlannerPromptJson.js";
import type { AgentToolCallPlannerPromptInput } from "../AgentToolCallPlannerPromptJson.js";
import { buildToolCallPlannerPromptJson } from "../AgentToolCallPlannerPromptJson.js";
import {
  buildActionPlannerPromptJson,
  buildEvidenceVerificationPromptJson,
} from "./AgentActionPlannerPromptJson.js";
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
      functionName: "BuildTaskFrame";
      input: ActionPlanInput;
    }
  | {
      functionName: "RepairTaskFrame";
      input: ActionPlanInput;
      invalidTaskFrame: string;
      issues: string[];
    }
  | {
      functionName: "RepairInteractionRoute";
      input: ActionPlanInput;
      invalidRoute: string;
      issues: string[];
    }
  | {
      functionName: "VerifyTaskEvidence";
      input: ActionPlanInput;
      taskFrame: BamlTaskFrame;
    }
  | {
      functionName: "RepairEvidenceVerification";
      input: ActionPlanInput;
      taskFrame: BamlTaskFrame;
      invalidVerification: string;
      issues: string[];
    }
  | {
      functionName: "PlanFastContextScout";
      input: AgentFastContextScoutPlannerPromptInput;
    }
  | {
      functionName: "RepairFastContextScoutPlan";
      input: AgentFastContextScoutPlannerPromptInput;
      invalidDecision: string;
      issues: string[];
    }
  | {
      functionName: "PlanToolCalls";
      input: AgentToolCallPlannerPromptInput;
    }
  | {
      functionName: "RepairToolCallPlan";
      input: AgentToolCallPlannerPromptInput;
      invalidPlan: string;
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
    };

export class AgentActionPlannerBamlPromptFactory {
  private readonly promptRegistry = createPromptRegistry();

  async buildPrompt(args: AgentActionPlannerBamlFunctionArgs): Promise<AgentBamlModelRequest> {
    const request = await this.buildBamlRequest(args);
    const prompt = projectActionPlannerBamlRequestBody(request.body.json() as Record<string, unknown>);
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
      case "BuildTaskFrame":
        return baml.request.BuildTaskFrame(
          buildActionPlannerPromptJson(args.input, {
            stage: "buildTaskFrame",
          }),
          options,
        );
      case "RepairTaskFrame":
        return baml.request.RepairTaskFrame(
          buildActionPlannerPromptJson(args.input, {
            stage: "repairTaskFrame",
            invalidTaskFrame: args.invalidTaskFrame,
            issues: args.issues,
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
      case "VerifyTaskEvidence":
        return baml.request.VerifyTaskEvidence(
          buildEvidenceVerificationPromptJson(args.input, args.taskFrame),
          options,
        );
      case "RepairEvidenceVerification":
        return baml.request.RepairEvidenceVerification(
          buildEvidenceVerificationPromptJson(args.input, args.taskFrame, {
            stage: "repairEvidenceVerification",
            invalidVerification: args.invalidVerification,
            issues: args.issues,
          }),
          options,
        );
      case "PlanFastContextScout":
        return baml.request.PlanFastContextScout(
          buildFastContextScoutPromptJson(args.input, {
            stage: "planFastContextScout",
          }),
          options,
        );
      case "RepairFastContextScoutPlan":
        return baml.request.RepairFastContextScoutPlan(
          buildFastContextScoutPromptJson(args.input, {
            stage: "repairFastContextScoutPlan",
            invalidDecision: args.invalidDecision,
            issues: args.issues,
          }),
          options,
        );
      case "PlanToolCalls":
        return baml.request.PlanToolCalls(
          buildToolCallPlannerPromptJson(args.input, {
            stage: "planToolCalls",
          }),
          options,
        );
      case "RepairToolCallPlan":
        return baml.request.RepairToolCallPlan(
          buildToolCallPlannerPromptJson(args.input, {
            stage: "repairToolCallPlan",
            invalidPlan: args.invalidPlan,
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
