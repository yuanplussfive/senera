import { ActionKind, type ActionPlanInput } from "./BamlClient/baml_client/index.js";

export type AgentActionPlannerPromptStage =
  | {
      stage: "selectAction";
    }
  | {
      stage: "repairActionSelection";
      invalidSelection: string;
      issues: readonly string[];
    }
  | {
      stage: "buildActionPayload";
      selectedAction: ActionKind;
    }
  | {
      stage: "repairActionPayload";
      selectedAction: ActionKind;
      invalidDecision: string;
      issues: readonly string[];
    };

export interface AgentActionPlannerPromptEnvelope {
  context: AgentActionPlannerPromptContext;
  directive: AgentActionPlannerPromptStage;
}

export interface AgentActionPlannerPromptContext {
  timeline: ActionPlanInput["timeline"];
  runState: ActionPlanInput["runState"];
  toolCatalog: ActionPlanInput["toolCatalog"];
  evidenceMemory: ActionPlanInput["evidenceMemory"];
  plannerJournal: ActionPlanInput["plannerJournal"];
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
  return {
    context: {
      timeline: input.timeline,
      runState: input.runState,
      toolCatalog: input.toolCatalog,
      evidenceMemory: input.evidenceMemory,
      plannerJournal: input.plannerJournal,
    },
    directive,
  };
}
