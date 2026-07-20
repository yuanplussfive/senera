import type { ActionPlanInput } from "../BamlClient/baml_client/index.js";
import type { AgentPiToolCard } from "../PiProxy/AgentPiAssistantMessageTypes.js";

export type AgentActionPlannerPromptStage =
  | {
      stage: "prepareInteraction";
    }
  | {
      stage: "repairInteractionPreparation";
      invalidPreparation: string;
      issues: readonly string[];
    };

export interface AgentActionPlannerPromptEnvelope {
  context: AgentActionPlannerPromptContext;
  directive: AgentActionPlannerPromptStage;
}

export interface AgentActionPlannerPromptContext {
  currentUserTurn: ActionPlanInput["currentUserTurn"];
  turnUnderstanding: ActionPlanInput["turnUnderstanding"];
  roleplayPreset?: ActionPlanInput["roleplayPreset"];
  timeline: ActionPlanInput["timeline"];
  runState: ActionPlanInput["runState"];
  toolTagCatalog: ActionPlanInput["toolTagCatalog"];
  compactToolCatalog: ActionPlanInput["compactToolCatalog"];
  toolCatalog?: ActionPlanInput["toolCatalog"];
  evidenceMemory: ActionPlanInput["evidenceMemory"];
  evidenceState: ActionPlanInput["evidenceState"];
  plannerJournal: ActionPlanInput["plannerJournal"];
  activeSkills: ActionPlanInput["activeSkills"];
  candidateTools: AgentPiToolCard[];
}

export function buildActionPlannerPromptJson(
  input: ActionPlanInput,
  candidateTools: readonly AgentPiToolCard[],
  directive: AgentActionPlannerPromptStage,
): string {
  return JSON.stringify(buildActionPlannerPromptEnvelope(input, candidateTools, directive), null, 2);
}

export function buildActionPlannerPromptEnvelope(
  input: ActionPlanInput,
  candidateTools: readonly AgentPiToolCard[],
  directive: AgentActionPlannerPromptStage,
): AgentActionPlannerPromptEnvelope {
  const candidateToolNames = new Set(candidateTools.map((tool) => tool.name));
  return {
    context: {
      currentUserTurn: input.currentUserTurn,
      turnUnderstanding: input.turnUnderstanding,
      roleplayPreset: input.roleplayPreset,
      timeline: input.timeline,
      runState: input.runState,
      toolTagCatalog: input.toolTagCatalog,
      compactToolCatalog: input.compactToolCatalog.filter((tool) => candidateToolNames.has(tool.name)),
      evidenceMemory: input.evidenceMemory,
      evidenceState: input.evidenceState,
      plannerJournal: input.plannerJournal,
      activeSkills: input.activeSkills,
      candidateTools: candidateTools.map((tool) => structuredClone(tool)),
    },
    directive,
  };
}
