import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";

export const AgentActionPlannerStageNames = {
  UnderstandUserTurn: "understandUserTurn",
} as const;

export type AgentActionPlannerStageName =
  (typeof AgentActionPlannerStageNames)[keyof typeof AgentActionPlannerStageNames];

export interface AgentActionPlannerStageStarted {
  stage: AgentActionPlannerStageName;
}

export interface AgentActionPlannerStageCompleted {
  stage: AgentActionPlannerStageName;
  selectedAction?: string;
  repaired?: boolean;
  turnUnderstanding?: TurnUnderstanding;
}

export interface AgentActionPlannerStageFailed {
  stage: AgentActionPlannerStageName;
  message: string;
}

export type AgentActionPlannerStageEvent =
  | ({ status: "started" } & AgentActionPlannerStageStarted)
  | ({ status: "completed" } & AgentActionPlannerStageCompleted)
  | ({ status: "failed" } & AgentActionPlannerStageFailed);

export type AgentActionPlannerStageSink = (event: AgentActionPlannerStageEvent) => void | Promise<void>;
