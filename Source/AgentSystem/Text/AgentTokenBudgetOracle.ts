import { AgentModelTokenEstimator } from "./AgentTextBudget.js";
import { inspectAgentModelInputTokens } from "./AgentMultimodalTokenBudget.js";

export type AgentTokenBudgetInspection =
  { readonly kind: "exact"; readonly tokens: number } | { readonly kind: "overBudget"; readonly tokenLimit: number };

export class AgentTokenBudgetOracle {
  private readonly estimator: AgentModelTokenEstimator;

  constructor(model: string) {
    this.estimator = new AgentModelTokenEstimator({ model });
  }

  inspectJson(value: unknown, tokenLimit: number): AgentTokenBudgetInspection {
    const normalizedLimit = normalizePositiveInteger(tokenLimit);
    const inspection = inspectAgentModelInputTokens(this.estimator, value, normalizedLimit);
    return inspection.withinLimit
      ? { kind: "exact", tokens: inspection.tokenCount ?? normalizedLimit }
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

function normalizePositiveInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
