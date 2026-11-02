import type { Usage } from "@earendil-works/pi-ai";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentModelsDevCatalog, AgentModelsDevPricing } from "./AgentModelsDevCatalog.js";
import type { AgentModelUsageValue } from "./AgentModelUsage.js";

export type AgentModelPriceKind = keyof AgentModelsDevPricing;

export interface AgentModelCost {
  readonly currency: "USD";
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  /** Provider billed total, or an estimate when every consumed category is priced. */
  readonly total?: number;
  /** True only when the entire total was reported as billed by the provider. */
  readonly totalFromProvider?: boolean;
}

export type AgentPricedPiUsage = Usage & { seneraCost?: AgentModelCost; seneraUsage?: AgentModelUsageValue };

const PriceKinds = ["input", "output", "cacheRead", "cacheWrite"] as const;
const TokensPerMillion = 1_000_000;

/** Pi normalizes input to uncached input; cache reads/writes are disjoint categories. */
export function calculateAgentModelCost(
  tokens: Partial<Record<AgentModelPriceKind, number>>,
  prices?: AgentModelsDevPricing,
  reported?: Pick<AgentModelCost, "total" | "totalFromProvider">,
): AgentModelCost {
  const amounts = Object.fromEntries(
    PriceKinds.flatMap((kind) => {
      const count = tokens[kind];
      if (count === undefined) return [];
      const price = prices?.[kind];
      return count === 0 ? [[kind, 0]] : price === undefined ? [] : [[kind, (count * price) / TokensPerMillion]];
    }),
  ) as Partial<Record<AgentModelPriceKind, number>>;
  return {
    currency: "USD",
    ...amounts,
    ...(reported?.totalFromProvider === true &&
    reported.total !== undefined &&
    Number.isFinite(reported.total) &&
    reported.total >= 0
      ? { total: reported.total, totalFromProvider: true }
      : PriceKinds.every((kind) => amounts[kind] !== undefined)
        ? { total: PriceKinds.reduce((total, kind) => total + amounts[kind]!, 0) }
        : {}),
  };
}

export function aggregateAgentModelCosts(costs: readonly (AgentModelCost | undefined)[]): AgentModelCost {
  const sum = (kind: AgentModelPriceKind | "total"): number | undefined =>
    costs.every((cost) => cost?.[kind] !== undefined)
      ? costs.reduce((total, cost) => total + cost![kind]!, 0)
      : undefined;
  return {
    currency: "USD",
    ...Object.fromEntries([...PriceKinds, "total" as const].map((kind) => [kind, sum(kind)])),
    ...(costs.length > 0 && costs.every((cost) => cost?.total !== undefined && cost.totalFromProvider === true)
      ? { totalFromProvider: true }
      : {}),
  };
}

/** Pi requires numeric prices; unknown prices remain explicit in seneraCost, never inferred from Pi's zero. */
export function projectAgentPiModelPrices(prices?: AgentModelsDevPricing): Record<AgentModelPriceKind, number> {
  return Object.fromEntries(PriceKinds.map((kind) => [kind, prices?.[kind] ?? 0])) as Record<
    AgentModelPriceKind,
    number
  >;
}

export function priceAgentPiUsage(usage: Usage, prices?: AgentModelsDevPricing): void {
  const cost = calculateAgentModelCost(usage, prices, usage.cost);
  (usage as AgentPricedPiUsage).seneraCost = cost;
  usage.cost = {
    ...projectAgentPiModelPrices(cost),
    total: cost.total ?? 0,
    totalFromProvider: cost.totalFromProvider,
  };
}

/** Runtime-only reference prices; editing configuration never persists an automatic price as an override. */
export function withAgentModelsDevPricing(
  config: AgentSystemConfig,
  catalog: Pick<AgentModelsDevCatalog, "resolve">,
): AgentSystemConfig {
  return {
    ...config,
    ModelProviders: config.ModelProviders.map((model) => {
      const pricing = { ...catalog.resolve(model.ProviderId, model.Model)?.pricing, ...model.Pricing };
      return { ...model, ...(Object.keys(pricing).length > 0 ? { Pricing: pricing } : {}) };
    }),
  };
}
