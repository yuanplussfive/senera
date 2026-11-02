const Percentage = 100;
/** A neutral Beta(1, 1) prior starts at 50, without a claim about truth. */
const TaskPrior = 1;
/** Uniform SDK multiplier; task weight is applied exactly once by the host. */
export const AgentMemoryRetrievalTrust = 1;

/** Only completed, assessed tasks contribute. Delivery alone never earns weight. */
export function agentMemoryWeight(helpfulTasks: number, unhelpfulTasks: number): number {
  return (Percentage * (TaskPrior + helpfulTasks)) / (2 * TaskPrior + helpfulTasks + unhelpfulTasks);
}
