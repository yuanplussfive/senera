import {
  continuitySignalId,
  isAgentContinuityTemporalActive,
  type AgentContinuityCondition,
  type AgentContinuityConditionTrace,
  type AgentContinuityRule,
  type AgentContinuityRuleEvaluation,
  type AgentContinuityScalar,
  type AgentContinuitySignal,
  type AgentContinuityTruth,
} from "./AgentContinuityDomain.js";
import { agentContinuitySignalScopePriority } from "./AgentContinuityScopes.js";

export function evaluateAgentContinuityRule(
  rule: AgentContinuityRule,
  signals: readonly AgentContinuitySignal[],
  now: Date,
): AgentContinuityRuleEvaluation {
  if (rule.status === "cancelled" || rule.status === "resolved") {
    return emptyEvaluation(rule.status);
  }
  if (rule.action.activation === "once" && rule.lastTriggeredAt) {
    return emptyEvaluation("resolved");
  }
  if (!isAgentContinuityTemporalActive(rule.temporal, now)) {
    const status = rule.temporal.endsAt && Date.parse(rule.temporal.endsAt) < now.getTime() ? "expired" : "armed";
    return emptyEvaluation(status);
  }

  const signalsById = selectSignalsForRule(rule, signals);
  const result = evaluateCondition(rule.condition, signalsById, now);
  return {
    truth: result.truth,
    status: result.truth === "true" ? "triggered" : result.truth === "unknown" ? "partial" : "armed",
    score: result.score,
    threshold: result.threshold,
    missingSignals: [...result.missingSignals].sort(),
    conditions: result.conditions,
  };
}

function selectSignalsForRule(
  rule: AgentContinuityRule,
  signals: readonly AgentContinuitySignal[],
): ReadonlyMap<string, AgentContinuitySignal> {
  const selected = new Map<string, AgentContinuitySignal>();
  for (const signal of signals) {
    const id = continuitySignalId(signal.namespace, signal.key);
    const current = selected.get(id);
    const priority = agentContinuitySignalScopePriority(rule.scope, signal.scope);
    if (priority === 0) continue;
    if (!current || priority > agentContinuitySignalScopePriority(rule.scope, current.scope)) {
      selected.set(id, signal);
    }
  }
  return selected;
}

interface ConditionResult {
  readonly truth: AgentContinuityTruth;
  readonly score: number;
  readonly upperScore: number;
  readonly threshold: number;
  readonly missingSignals: ReadonlySet<string>;
  readonly conditions: readonly AgentContinuityConditionTrace[];
}

function evaluateCondition(
  condition: AgentContinuityCondition,
  signals: ReadonlyMap<string, AgentContinuitySignal>,
  now: Date,
): ConditionResult {
  switch (condition.kind) {
    case "always":
      return knownResult("true", 1, 1, [{ label: "always", truth: "true", score: 1 }]);
    case "all":
      return evaluateAll(condition.children, signals, now);
    case "any":
      return evaluateAny(condition.children, signals, now);
    case "at_least":
      return evaluateAtLeast(condition.children, condition.minimum, signals, now);
    case "score":
      return evaluateScore(condition.children, condition.threshold, signals, now);
    case "not":
      return invertResult(evaluateCondition(condition.child, signals, now));
    case "time_at_or_after": {
      const truth = now.getTime() >= Date.parse(condition.at) ? "true" : "false";
      return knownResult(truth, truth === "true" ? 1 : 0, 1, [
        { label: `time >= ${condition.at}`, truth, score: truth === "true" ? 1 : 0 },
      ]);
    }
    case "signal":
      return evaluateSignal(condition, signals.get(continuitySignalId(condition.namespace, condition.key)));
  }
}

function evaluateAll(
  children: readonly AgentContinuityCondition[],
  signals: ReadonlyMap<string, AgentContinuitySignal>,
  now: Date,
): ConditionResult {
  const results = children.map((child) => evaluateCondition(child, signals, now));
  const truth = results.some((result) => result.truth === "false")
    ? "false"
    : results.some((result) => result.truth === "unknown")
      ? "unknown"
      : "true";
  return combineResults(truth, Math.min(...results.map((result) => result.score)), 1, results);
}

function evaluateAny(
  children: readonly AgentContinuityCondition[],
  signals: ReadonlyMap<string, AgentContinuitySignal>,
  now: Date,
): ConditionResult {
  const results = children.map((child) => evaluateCondition(child, signals, now));
  const truth = results.some((result) => result.truth === "true")
    ? "true"
    : results.some((result) => result.truth === "unknown")
      ? "unknown"
      : "false";
  return combineResults(truth, Math.max(...results.map((result) => result.score)), 1, results);
}

function evaluateAtLeast(
  children: readonly AgentContinuityCondition[],
  minimum: number,
  signals: ReadonlyMap<string, AgentContinuitySignal>,
  now: Date,
): ConditionResult {
  const results = children.map((child) => evaluateCondition(child, signals, now));
  const trueCount = results.filter((result) => result.truth === "true").length;
  const unknownCount = results.filter((result) => result.truth === "unknown").length;
  const truth = trueCount >= minimum ? "true" : trueCount + unknownCount < minimum ? "false" : "unknown";
  return combineResults(truth, trueCount / results.length, minimum / results.length, results);
}

function evaluateScore(
  children: readonly AgentContinuityCondition[],
  threshold: number,
  signals: ReadonlyMap<string, AgentContinuitySignal>,
  now: Date,
): ConditionResult {
  const results = children.map((child) => evaluateCondition(child, signals, now));
  const score = average(results.map((result) => result.score));
  const upperScore = average(results.map((result) => result.upperScore));
  const truth = score >= threshold ? "true" : upperScore < threshold ? "false" : "unknown";
  return combineResults(truth, score, threshold, results, upperScore);
}

function evaluateSignal(
  condition: Extract<AgentContinuityCondition, { kind: "signal" }>,
  signal: AgentContinuitySignal | undefined,
): ConditionResult {
  const id = continuitySignalId(condition.namespace, condition.key);
  const stateLabel = condition.label ?? id;
  const label = `${stateLabel}${operatorLabel(condition.operator)}${formatExpectedValue(condition.value)}`;
  if (!signal) return unknownResult(stateLabel, label);
  if (condition.operator === "exists") {
    return knownResult("true", 1, 1, [{ label, truth: "true", score: 1, actual: scalarValue(signal.value) }]);
  }
  if (condition.value === undefined) return unknownResult(stateLabel, label);
  const comparison = compareValues(signal.value, condition.value);
  if (comparison === undefined) return unknownResult(stateLabel, label, scalarValue(signal.value));

  const matches =
    condition.operator === "equals"
      ? comparison === 0
      : condition.operator === "not_equals"
        ? comparison !== 0
        : condition.operator === "greater_than"
          ? comparison > 0
          : condition.operator === "greater_than_or_equal"
            ? comparison >= 0
            : condition.operator === "less_than"
              ? comparison < 0
              : comparison <= 0;
  const truth = matches ? "true" : "false";
  return knownResult(truth, matches ? 1 : 0, 1, [
    { label, truth, score: matches ? 1 : 0, actual: scalarValue(signal.value) },
  ]);
}

function combineResults(
  truth: AgentContinuityTruth,
  score: number,
  threshold: number,
  results: readonly ConditionResult[],
  upperScore = truth === "unknown" ? 1 : score,
): ConditionResult {
  return {
    truth,
    score: clampScore(score),
    upperScore: clampScore(upperScore),
    threshold,
    missingSignals: new Set(results.flatMap((result) => [...result.missingSignals])),
    conditions: results.flatMap((result) => result.conditions),
  };
}

function knownResult(
  truth: AgentContinuityTruth,
  score: number,
  threshold: number,
  conditions: readonly AgentContinuityConditionTrace[],
): ConditionResult {
  return { truth, score, upperScore: score, threshold, missingSignals: new Set(), conditions };
}

function unknownResult(id: string, label: string, actual?: AgentContinuityScalar): ConditionResult {
  return {
    truth: "unknown",
    score: 0,
    upperScore: 1,
    threshold: 1,
    missingSignals: new Set([id]),
    conditions: [{ label, truth: "unknown", score: 0, ...(actual !== undefined ? { actual } : {}) }],
  };
}

function emptyEvaluation(status: AgentContinuityRuleEvaluation["status"]): AgentContinuityRuleEvaluation {
  return { truth: "false", status, score: 0, threshold: 1, missingSignals: [], conditions: [] };
}

function invertResult(result: ConditionResult): ConditionResult {
  return {
    ...result,
    truth: invertTruth(result.truth),
    score: 1 - result.upperScore,
    upperScore: 1 - result.score,
    conditions: result.conditions.map((condition) => ({
      ...condition,
      label: `NOT ${condition.label}`,
      truth: invertTruth(condition.truth),
      score: 1 - condition.score,
    })),
  };
}

function compareValues(left: unknown, right: AgentContinuityScalar): number | undefined {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") return left.localeCompare(right);
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return undefined;
}

function scalarValue(value: unknown): AgentContinuityScalar | undefined {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}

function operatorLabel(operator: Extract<AgentContinuityCondition, { kind: "signal" }>["operator"]): string {
  return {
    exists: "",
    equals: " = ",
    not_equals: " != ",
    greater_than: " > ",
    greater_than_or_equal: " >= ",
    less_than: " < ",
    less_than_or_equal: " <= ",
  }[operator];
}

function formatExpectedValue(value: AgentContinuityScalar | undefined): string {
  return value === undefined ? "" : JSON.stringify(value);
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function invertTruth(value: AgentContinuityTruth): AgentContinuityTruth {
  if (value === "true") return "false";
  if (value === "false") return "true";
  return "unknown";
}
