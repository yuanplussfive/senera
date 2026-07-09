import type { ActionPlanInput } from "../BamlClient/baml_client/index.js";

export type AgentActionPlannerPromptStage =
  | {
      stage: "understandUserTurn";
    }
  | {
      stage: "repairTurnUnderstanding";
      invalidUnderstanding: string;
      issues: readonly string[];
    }
  | {
      stage: "routeInteraction";
    }
  | {
      stage: "repairInteractionRoute";
      invalidRoute: string;
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
}

export function buildActionPlannerPromptJson(
  input: ActionPlanInput,
  directive: AgentActionPlannerPromptStage,
): string {
  return JSON.stringify(buildActionPlannerPromptEnvelope(input, directive), null, 2);
}

export function buildActionPlannerPromptEnvelope(
  input: ActionPlanInput,
  directive: AgentActionPlannerPromptStage,
): AgentActionPlannerPromptEnvelope {
  const includeRoleplayPreset = directive.stage === "understandUserTurn"
    || directive.stage === "repairTurnUnderstanding";
  return {
    context: {
      currentUserTurn: input.currentUserTurn,
      turnUnderstanding: input.turnUnderstanding,
      ...(includeRoleplayPreset ? { roleplayPreset: input.roleplayPreset } : {}),
      timeline: input.timeline,
      runState: input.runState,
      toolTagCatalog: input.toolTagCatalog,
      compactToolCatalog: input.compactToolCatalog,
      evidenceMemory: input.evidenceMemory,
      evidenceState: input.evidenceState,
      plannerJournal: input.plannerJournal,
      activeSkills: input.activeSkills,
    },
    directive,
  };
}
