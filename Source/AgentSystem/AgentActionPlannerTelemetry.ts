export const AgentActionPlannerStageNames = {
  SelectAction: "selectAction",
  BuildActionPayload: "buildActionPayload",
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
