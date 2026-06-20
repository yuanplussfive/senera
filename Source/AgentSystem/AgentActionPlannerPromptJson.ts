import type { ActionPlanInput, TaskFrame } from "./BamlClient/baml_client/index.js";

export type AgentActionPlannerPromptStage =
  | {
      stage: "buildTaskFrame";
    }
  | {
      stage: "repairTaskFrame";
      invalidTaskFrame: string;
      issues: readonly string[];
    }
  | {
      stage: "verifyTaskEvidence";
    };

export interface AgentActionPlannerPromptEnvelope {
  context: AgentActionPlannerPromptContext;
  directive: AgentActionPlannerPromptStage;
}

export interface AgentActionPlannerPromptContext {
  timeline: ActionPlanInput["timeline"];
  runState: ActionPlanInput["runState"];
  compactToolCatalog: ActionPlanInput["compactToolCatalog"];
  toolCatalog: ActionPlanInput["toolCatalog"];
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
  return {
    context: {
      timeline: input.timeline,
      runState: input.runState,
      compactToolCatalog: input.compactToolCatalog,
      toolCatalog: input.toolCatalog,
      evidenceMemory: input.evidenceMemory,
      evidenceState: input.evidenceState,
      plannerJournal: input.plannerJournal,
      activeSkills: input.activeSkills,
    },
    directive,
  };
}

export function buildEvidenceVerificationPromptJson(
  input: ActionPlanInput,
  taskFrame: TaskFrame,
): string {
  return JSON.stringify({
    context: {
      task: {
        taskType: taskFrame.taskType,
        answerGoal: taskFrame.answerGoal,
        intentTags: taskFrame.intentTags,
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
        ...taskFrame.requiredEvidence.map((requirement) => ({
          id: requirement.id,
          kind: "evidence",
          need: requirement.need,
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
    directive: {
      stage: "verifyTaskEvidence",
    },
  }, null, 2);
}
