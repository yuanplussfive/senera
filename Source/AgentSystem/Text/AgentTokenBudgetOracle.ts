import { AgentModelTokenEstimator } from "./AgentTextBudget.js";
import { maySerializeWithinTokenBudget } from "./AgentBudgetedJsonProjection.js";

export type AgentTokenBudgetInspection =
  { readonly kind: "exact"; readonly tokens: number } | { readonly kind: "overBudget"; readonly tokenLimit: number };

export class AgentTokenBudgetOracle {
  private readonly estimator: AgentModelTokenEstimator;

  constructor(model: string) {
    this.estimator = new AgentModelTokenEstimator({ model });
  }

  inspectJson(value: unknown, tokenLimit: number): AgentTokenBudgetInspection {
    const normalizedLimit = normalizePositiveInteger(tokenLimit);
    if (!maySerializeWithinTokenBudget(value, normalizedLimit)) {
      return { kind: "overBudget", tokenLimit: normalizedLimit };
    }
    const serialized = serializeJson(value);
    const inspection = this.estimator.inspect(serialized, normalizedLimit);
    return inspection.withinLimit
      ? { kind: "exact", tokens: inspection.tokenCount }
      : { kind: "overBudget", tokenLimit: normalizedLimit };
  }

  inspectText(value: string, tokenLimit: number): AgentTokenBudgetInspection {
    const normalizedLimit = normalizePositiveInteger(tokenLimit);
    const inspection = this.estimator.inspect(value, normalizedLimit);
    return inspection.withinLimit
      ? { kind: "exact", tokens: inspection.tokenCount }
      : { kind: "overBudget", tokenLimit: normalizedLimit };
  }
}

function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, entry: unknown) =>
    typeof entry === "bigint" ? String(entry) : entry,
  );
  if (serialized === undefined) throw new Error("Token budget inspection requires a JSON-serializable value.");
  return serialized;
}

function normalizePositiveInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
