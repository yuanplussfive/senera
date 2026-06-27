import type { TaskFrame, TurnUnderstanding } from "./BamlClient/baml_client/types.js";
import type { AgentCompletionGateDecision } from "./AgentCompletionGate.js";

export const AgentActionPlannerStageNames = {
  UnderstandUserTurn: "understandUserTurn",
  BuildTaskFrame: "buildTaskFrame",
  EvaluateEvidence: "evaluateEvidence",
} as const;

export type AgentActionPlannerStageName =
  typeof AgentActionPlannerStageNames[keyof typeof AgentActionPlannerStageNames];

export interface AgentActionPlannerStageStarted {
  stage: AgentActionPlannerStageName;
}

export interface AgentActionPlannerStageCompleted {
  stage: AgentActionPlannerStageName;
  selectedAction?: string;
  repaired?: boolean;
  turnUnderstanding?: TurnUnderstanding;
  taskFrame?: TaskFrame;
  evidenceDecision?: AgentCompletionGateDecision;
}

export interface AgentActionPlannerStageFailed {
  stage: AgentActionPlannerStageName;
  message: string;
}

export type AgentActionPlannerStageEvent =
  | ({ status: "started" } & AgentActionPlannerStageStarted)
  | ({ status: "completed" } & AgentActionPlannerStageCompleted)
  | ({ status: "failed" } & AgentActionPlannerStageFailed);

export type AgentActionPlannerStageSink =
  (event: AgentActionPlannerStageEvent) => void | Promise<void>;
