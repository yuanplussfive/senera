import {
  continuitySignalId,
  type AgentContinuityCondition,
  type AgentContinuitySignal,
} from "./AgentContinuityDomain.js";
import type { AgentContinuityEvaluatedState } from "./AgentContinuityMemoryServiceSupport.js";

/**
 * Selects only the signals that explain rules currently visible to the model.
 * This follows the evaluated condition tree rather than presentation labels.
 */
export function selectAgentContinuityLiveStateSignals(
  evaluatedRules: readonly AgentContinuityEvaluatedState["evaluatedRules"][number][],
  signals: readonly AgentContinuitySignal[],
): readonly AgentContinuitySignal[] {
  const required = new Set<string>();
  for (const { rule } of evaluatedRules) collectConditionSignalIds(rule.condition, required);
  if (required.size === 0) return [];

  return signals
    .filter((signal) => required.has(continuitySignalId(signal.namespace, signal.key)))
    .sort(
      (left, right) =>
        left.namespace.localeCompare(right.namespace) ||
        left.key.localeCompare(right.key) ||
        right.observedAt.localeCompare(left.observedAt),
    );
}

function collectConditionSignalIds(condition: AgentContinuityCondition, target: Set<string>): void {
  switch (condition.kind) {
    case "signal":
      target.add(continuitySignalId(condition.namespace, condition.key));
      return;
    case "all":
    case "any":
    case "at_least":
    case "score":
      condition.children.forEach((child) => collectConditionSignalIds(child, target));
      return;
    case "not":
      collectConditionSignalIds(condition.child, target);
      return;
    case "always":
    case "time_at_or_after":
      return;
  }
}
