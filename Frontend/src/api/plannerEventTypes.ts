export const ActionPlannerStageNames = {
  PrepareInteraction: "prepareInteraction",
} as const;

export type ActionPlannerStageName = (typeof ActionPlannerStageNames)[keyof typeof ActionPlannerStageNames];

export type TurnContextMode = "None" | "Used" | "Insufficient";

export interface TurnUnderstandingData {
  rawUserTurn: string;
  standaloneRequest: string;
  contextMode: TurnContextMode;
  contextBasis: string;
  missingContext: string;
}

export interface ActionPlannerStageStartedData {
  stage: ActionPlannerStageName;
}

export interface ActionPlannerStageCompletedData {
  stage: ActionPlannerStageName;
  durationMs: number;
  selectedAction?: string;
  repaired?: boolean;
  turnUnderstanding?: TurnUnderstandingData;
}

export interface ActionPlannerStageFailedData {
  stage: ActionPlannerStageName;
  durationMs: number;
  message: string;
}
