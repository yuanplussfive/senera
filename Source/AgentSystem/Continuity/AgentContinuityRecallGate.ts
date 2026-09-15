import type { AgentTurnValueClassification } from "./AgentTurnValueClassifier.js";

export interface AgentContinuityTurnValueRecallGateConfig {
  readonly enabled: boolean;
}

export interface AgentContinuityRecallDecision {
  readonly shouldRecallText: boolean;
  readonly reason: "disabled" | "unproductive_classified" | "semantic";
}

/** Uses the same learned turn-value signal for recall and learning decisions. */
export function decideAgentContinuityRecall(
  config: AgentContinuityTurnValueRecallGateConfig,
  classification?: AgentTurnValueClassification,
): AgentContinuityRecallDecision {
  if (!config.enabled) return { shouldRecallText: true, reason: "disabled" };
  return classification?.label === "unproductive"
    ? { shouldRecallText: false, reason: "unproductive_classified" }
    : { shouldRecallText: true, reason: "semantic" };
}
