import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { TaskFrame, TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import type { AgentCompletionGateDecision } from "../Loop/AgentCompletionGateTypes.js";

export type AgentTaskFrameEventData = Pick<
  TaskFrame,
  | "taskType"
  | "answerGoal"
  | "intentTags"
  | "targetRefs"
  | "candidateTools"
  | "discoveryQueries"
  | "requiredEffects"
  | "requiredEvidence"
  | "userInputNeeds"
  | "nextStepPurpose"
  | "completionCriteria"
  | "notes"
>;

export type AgentTurnUnderstandingEventData = TurnUnderstanding;

export type AgentPlannerEvidenceDecisionEventData = Omit<AgentCompletionGateDecision, "action">;

export type AgentActivatedSkillEventData = Pick<
  AgentActivatedSkill,
  | "name"
  | "title"
  | "score"
  | "matchedTerms"
  | "matchedFields"
  | "recommendedTools"
  | "recommendedAgents"
  | "recommendedWorkflows"
>;
