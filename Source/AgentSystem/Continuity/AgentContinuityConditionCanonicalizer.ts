import type { AgentContinuityCondition } from "./AgentContinuityDomain.js";

/** Produces a stable condition tree for identity without changing evaluation semantics. */
export function canonicalizeAgentContinuityCondition(condition: AgentContinuityCondition): AgentContinuityCondition {
  if (condition.kind === "all" || condition.kind === "any") {
    return {
      kind: condition.kind,
      children: canonicalChildren(condition.children),
    };
  }
  if (condition.kind === "at_least") {
    return {
      kind: condition.kind,
      minimum: condition.minimum,
      children: canonicalChildren(condition.children),
    };
  }
  if (condition.kind === "score") {
    return {
      kind: condition.kind,
      threshold: condition.threshold,
      children: canonicalChildren(condition.children),
    };
  }
  if (condition.kind === "not") {
    return { kind: "not", child: canonicalizeAgentContinuityCondition(condition.child) };
  }
  if (condition.kind === "time_at_or_after") {
    return { kind: condition.kind, at: new Date(condition.at).toISOString() };
  }
  if (condition.kind === "signal") {
    return {
      kind: condition.kind,
      namespace: condition.namespace.trim(),
      key: condition.key.trim(),
      operator: condition.operator,
      ...(condition.value !== undefined ? { value: condition.value } : {}),
    };
  }
  return condition;
}

export function agentContinuityConditionKey(condition: AgentContinuityCondition): string {
  return JSON.stringify(canonicalizeAgentContinuityCondition(condition));
}

function canonicalChildren(children: readonly AgentContinuityCondition[]): AgentContinuityCondition[] {
  const unique = new Map<string, AgentContinuityCondition>();
  for (const child of children.map(canonicalizeAgentContinuityCondition)) {
    unique.set(JSON.stringify(child), child);
  }
  return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, child]) => child);
}
