import type { TaskFrame, TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import type {
  AgentPlannerEvidenceDecisionEventData,
  AgentTaskFrameEventData,
  AgentTurnUnderstandingEventData,
} from "../Events/AgentExecutionEventSharedTypes.js";
import type { AgentCompletionGateDecision } from "./AgentCompletionGateTypes.js";

export function projectTaskFrameForEvent(taskFrame: TaskFrame): AgentTaskFrameEventData {
  return {
    taskType: taskFrame.taskType,
    answerGoal: taskFrame.answerGoal,
    intentTags: taskFrame.intentTags,
    targetRefs: taskFrame.targetRefs,
    candidateTools: taskFrame.candidateTools,
    discoveryQueries: taskFrame.discoveryQueries,
    requiredEffects: taskFrame.requiredEffects,
    requiredEvidence: taskFrame.requiredEvidence,
    userInputNeeds: taskFrame.userInputNeeds,
    nextStepPurpose: taskFrame.nextStepPurpose,
    completionCriteria: taskFrame.completionCriteria,
    notes: taskFrame.notes,
  };
}

export function projectTurnUnderstandingForEvent(
  turnUnderstanding: TurnUnderstanding,
): AgentTurnUnderstandingEventData {
  return turnUnderstanding;
}

export function projectEvidenceDecisionForEvent(
  decision: AgentCompletionGateDecision,
): AgentPlannerEvidenceDecisionEventData {
  return {
    ready: decision.ready,
    missingNeeds: decision.missingNeeds,
    satisfiedNeeds: decision.satisfiedNeeds,
    requirementStates: decision.requirementStates,
    progress: decision.progress,
    verification: decision.verification,
    recommendedTools: decision.recommendedTools,
    searchQueries: decision.searchQueries,
  };
}

