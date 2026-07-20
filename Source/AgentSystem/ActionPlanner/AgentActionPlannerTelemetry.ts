import type { ParsedInteractionPreparation } from "./AgentActionPlannerSchema.js";

export const AgentActionPlannerStageNames = {
  PrepareInteraction: "prepareInteraction",
} as const;

export type AgentActionPlannerStageName =
  (typeof AgentActionPlannerStageNames)[keyof typeof AgentActionPlannerStageNames];

export interface AgentActionPlannerStageStarted {
  stage: AgentActionPlannerStageName;
}

export interface AgentActionPlannerStageCompleted {
  stage: AgentActionPlannerStageName;
  durationMs: number;
  selectedAction?: string;
  repaired?: boolean;
  preparation?: ParsedInteractionPreparation;
}

export interface AgentActionPlannerStageFailed {
  stage: AgentActionPlannerStageName;
  durationMs: number;
  message: string;
}

export type AgentActionPlannerStageEvent =
  | ({ status: "started" } & AgentActionPlannerStageStarted)
  | ({ status: "completed" } & AgentActionPlannerStageCompleted)
  | ({ status: "failed" } & AgentActionPlannerStageFailed);

export type AgentActionPlannerStageSink = (event: AgentActionPlannerStageEvent) => void | Promise<void>;
