import {
  TaskEvidenceScope,
  type ActionPlanInput,
  type TaskFrame,
} from "./BamlClient/baml_client/index.js";

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
      stage: "buildTaskFrame";
    }
  | {
      stage: "repairTaskFrame";
      invalidTaskFrame: string;
      issues: readonly string[];
    }
  | {
      stage: "repairInteractionRoute";
      invalidRoute: string;
      issues: readonly string[];
    }
  | {
      stage: "verifyTaskEvidence";
    }
  | {
      stage: "repairEvidenceVerification";
      invalidVerification: string;
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
  plannerState: ActionPlanInput["plannerState"];
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
      plannerState: input.plannerState,
      activeSkills: input.activeSkills,
    },
    directive,
  };
}

export function buildEvidenceVerificationPromptJson(
  input: ActionPlanInput,
  taskFrame: TaskFrame,
  directive: Extract<AgentActionPlannerPromptStage, {
    stage: "verifyTaskEvidence" | "repairEvidenceVerification";
  }> = {
    stage: "verifyTaskEvidence",
  },
): string {
  return JSON.stringify({
    context: {
      task: {
        taskType: taskFrame.taskType,
        answerGoal: taskFrame.answerGoal,
        intentTags: taskFrame.intentTags,
        taskTags: taskFrame.taskTags,
        targetRefs: taskFrame.targetRefs,
        discoveryQueries: taskFrame.discoveryQueries,
        requiredEffects: taskFrame.requiredEffects,
        requiredEvidence: taskFrame.requiredEvidence,
        userInputNeeds: taskFrame.userInputNeeds,
        nextStepPurpose: taskFrame.nextStepPurpose,
        completionCriteria: taskFrame.completionCriteria,
        notes: taskFrame.notes,
      },
      verificationRequirements: [
        ...taskFrame.requiredEvidence.filter(isCurrentRunEvidenceRequirement).map((requirement) => ({
          id: requirement.id,
          kind: "evidence",
          need: requirement.need,
          scope: requirement.scope,
          minimum: requirement.minimum,
          reason: requirement.reason,
        })),
        ...taskFrame.requiredEffects.map((requirement) => ({
          id: requirement.id,
          kind: "effect",
          need: requirement.target
            ? `${requirement.effect}: ${requirement.target}`
            : requirement.effect,
          minimum: 1,
          reason: [requirement.reason, requirement.proof].filter(Boolean).join("\n"),
        })),
      ],
      evidenceState: input.evidenceState,
      evidenceCatalog: input.toolCatalog.map((tool) => ({
        toolName: tool.name,
        title: tool.title,
        summary: tool.summary,
        evidenceCapabilities: tool.evidenceCapabilities,
      })),
      progress: {
        currentStep: input.runState.currentStep,
        progress: input.runState.progress,
        warnings: input.runState.warnings,
        calls: input.runState.calls,
      },
    },
    directive,
  }, null, 2);
}

function isCurrentRunEvidenceRequirement(
  requirement: TaskFrame["requiredEvidence"][number],
): boolean {
  return requirement.scope === TaskEvidenceScope.CurrentRun;
}
