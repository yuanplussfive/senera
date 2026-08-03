import { AgentModelTokenEstimator } from "./AgentTextBudget.js";

export type AgentTokenBudgetInspection =
  | { readonly kind: "exact"; readonly tokens: number }
  | { readonly kind: "overBudget"; readonly tokenLimit: number }
  | { readonly kind: "unknown"; readonly reason: "not_serializable" };

export class AgentTokenBudgetOracle {
  private readonly estimator: AgentModelTokenEstimator;

  constructor(model: string) {
    this.estimator = new AgentModelTokenEstimator({ model });
  }

  inspectJson(value: unknown, tokenLimit: number): AgentTokenBudgetInspection {
    const serialized = serializeJson(value);
    if (serialized === undefined) return { kind: "unknown", reason: "not_serializable" };
    const inspection = this.estimator.inspect(serialized, normalizePositiveInteger(tokenLimit));
    return inspection.withinLimit
      ? { kind: "exact", tokens: inspection.tokenCount }
      : { kind: "overBudget", tokenLimit: normalizePositiveInteger(tokenLimit) };
  }

  countJson(value: unknown): AgentTokenBudgetInspection {
    const serialized = serializeJson(value);
    return serialized === undefined
      ? { kind: "unknown", reason: "not_serializable" }
      : { kind: "exact", tokens: this.estimator.estimate(serialized).tokenCount };
  }
}

function serializeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, (_key, entry: unknown) => (typeof entry === "bigint" ? String(entry) : entry));
  } catch {
    return undefined;
  }
}

function normalizePositiveInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
