import type { ActionPlanInput } from "./BamlClient/baml_client/index.js";
import type { AgentPromptToolContext } from "./AgentPromptContextBuilder.js";
import type {
  AgentPromptContractProperty,
  AgentPromptContractView,
} from "./AgentPromptContractProjector.js";
import type { AgentRootCommand } from "./AgentRootCommand.js";
import type { AgentToolUsePattern } from "./AgentToolSearchMemory.js";

export type AgentToolCallPlannerPromptStage =
  | {
      stage: "planToolCalls";
    }
  | {
      stage: "repairToolCallPlan";
      invalidPlan: string;
      issues: readonly string[];
    };

export interface AgentToolCallPlannerPromptInput {
  actionInput: ActionPlanInput;
  rootCommand: AgentRootCommand;
  toolContracts: readonly AgentPromptToolContext[];
  toolUsePatterns?: readonly AgentToolUsePattern[];
}

export function buildToolCallPlannerPromptJson(
  input: AgentToolCallPlannerPromptInput,
  directive: AgentToolCallPlannerPromptStage,
): string {
  return JSON.stringify(buildToolCallPlannerPromptEnvelope(input, directive), null, 2);
}

export function buildToolCallPlannerPromptEnvelope(
  input: AgentToolCallPlannerPromptInput,
  directive: AgentToolCallPlannerPromptStage,
) {
  return {
    context: {
      currentUserTurn: input.actionInput.currentUserTurn,
      turnUnderstanding: input.actionInput.turnUnderstanding,
      timeline: input.actionInput.timeline,
      runState: input.actionInput.runState,
      evidenceMemory: input.actionInput.evidenceMemory,
      evidenceState: input.actionInput.evidenceState,
      plannerJournal: input.actionInput.plannerJournal,
      plannerState: input.actionInput.plannerState,
      compactToolCatalog: input.actionInput.compactToolCatalog,
      rootCommand: projectRootCommand(input.rootCommand),
      allowedTools: input.rootCommand.allowedTools,
      toolContracts: input.toolContracts.map(projectToolContract),
      toolUsePatterns: (input.toolUsePatterns ?? []).map(projectToolUsePattern),
    },
    directive,
  };
}

function projectRootCommand(rootCommand: AgentRootCommand): Record<string, unknown> {
  return {
    authority: rootCommand.authority,
    action: rootCommand.action,
    outputMode: rootCommand.outputMode,
    toolAccess: rootCommand.toolAccess,
    objective: rootCommand.objective,
    instruction: rootCommand.instruction,
    allowedTools: rootCommand.allowedTools,
    preferredTools: rootCommand.preferredTools,
    workflowRecommendedTools: rootCommand.workflowRecommendedTools,
    toolSearchQueries: rootCommand.toolSearchQueries,
    needs: rootCommand.needs,
    taskContract: rootCommand.taskContract,
    insufficiencyPolicy: rootCommand.insufficiencyPolicy,
  };
}

function projectToolContract(tool: AgentPromptToolContext): Record<string, unknown> {
  const argumentsContract = projectArgumentsContract(tool.argumentsContract);
  return {
    name: tool.name,
    description: tool.description,
    whenToUse: tool.whenToUse,
    whenNotToUse: tool.whenNotToUse,
    acceptedArguments: argumentsContract?.acceptedArguments ?? [],
    requiredArguments: argumentsContract?.requiredArguments ?? [],
    argumentsContract,
  };
}

function projectArgumentsContract(contract: AgentPromptContractView | undefined): Record<string, unknown> | undefined {
  if (!contract) {
    return undefined;
  }

  return {
    acceptedArguments: contract.properties.map((property) => property.name),
    requiredArguments: contract.properties
      .filter((property) => property.required)
      .map((property) => property.name),
    jsonSchema: contract.jsonSchema,
    fields: contract.properties.map(projectArgumentField),
  };
}

function projectArgumentField(property: AgentPromptContractProperty): Record<string, unknown> {
  return {
    name: property.name,
    kind: property.kind,
    type: property.typeText,
    required: property.required,
    description: property.comment,
    children: property.children.map(projectArgumentField),
    element: property.element ? projectArgumentField(property.element) : undefined,
  };
}

function projectToolUsePattern(pattern: AgentToolUsePattern): Record<string, unknown> {
  return {
    toolName: pattern.toolName,
    triggerSummary: pattern.triggerSummary,
    argumentGuidance: pattern.argumentGuidance,
    evidenceGoal: pattern.evidenceGoal,
    confidence: pattern.confidence,
    supportCount: pattern.supportCount,
  };
}
