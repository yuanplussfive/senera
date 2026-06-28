import type {
  AgentActionPlannerStageCompleted,
  AgentActionPlannerStageName,
  AgentActionPlannerStageSink,
} from "./AgentActionPlannerTelemetry.js";
import { summarizePlannerFailure } from "./AgentActionPlannerFailure.js";

type AgentActionPlannerStageCompletion = Omit<AgentActionPlannerStageCompleted, "stage">;

export async function runAgentActionPlannerStage<T>(
  stage: AgentActionPlannerStageName,
  onStage: AgentActionPlannerStageSink | undefined,
  work: () => Promise<T>,
  completed: (result: T) => AgentActionPlannerStageCompletion,
): Promise<T> {
  await onStage?.({
    status: "started",
    stage,
  });
  try {
    const result = await work();
    await onStage?.({
      status: "completed",
      stage,
      ...completed(result),
    });
    return result;
  } catch (error) {
    await onStage?.({
      status: "failed",
      stage,
      message: summarizePlannerFailure(error),
    });
    throw error;
  }
}
