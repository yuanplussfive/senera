import { describe, expect, test } from "vitest";
import {
  aggregateAgentModelCosts,
  calculateAgentModelCost,
  withAgentModelsDevPricing,
} from "../../../Source/AgentSystem/ModelEndpoints/AgentModelPricing.js";
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("model reference pricing", () => {
  test("charges disjoint cache categories without charging reasoning twice", () => {
    const cost = calculateAgentModelCost(
      { input: 1_000, output: 200, cacheRead: 5_000, cacheWrite: 100 },
      { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2.5 },
    );
    expect(cost).toMatchObject({
      currency: "USD",
      input: 0.002,
      output: 0.0016,
      cacheRead: 0.0025,
      cacheWrite: 0.00025,
    });
    expect(cost.total).toBeCloseTo(0.00635);
  });

  test("unknown consumed rates keep totals unknown; explicit zero is free", () => {
    const tokens = { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 };
    expect(calculateAgentModelCost(tokens, { input: 0 }).total).toBeUndefined();
    expect(calculateAgentModelCost(tokens, { input: 0, output: 0 }).total).toBe(0);
    expect(calculateAgentModelCost({ ...tokens, cacheWrite: 1 }, { input: 1, output: 2 }).total).toBeUndefined();
  });

  test("aggregates calls priced at their own rates without masking an unpriced call", () => {
    const ledger = new AgentModelUsageLedger();
    ledger.record({ stage: "first", usage: { source: "provider_reported", cost: { currency: "USD", total: 0.25 } } });
    ledger.record({ stage: "second", usage: { source: "provider_reported", cost: { currency: "USD", total: 0.5 } } });
    expect(ledger.aggregate()?.cost?.total).toBe(0.75);
    expect(aggregateAgentModelCosts([ledger.aggregate()?.cost, undefined]).total).toBeUndefined();
  });

  test("merges per-field overrides without mutating or persisting catalog defaults", () => {
    const model = {
      Id: "configured",
      ProviderId: "custom",
      Model: "model",
      Endpoint: "ChatCompletions" as const,
      Pricing: { input: 0 },
    };
    const config = { ModelProviders: [model] } as AgentSystemConfig;
    const projected = withAgentModelsDevPricing(config, {
      resolve: () => ({
        id: "model",
        sourceModelId: "model",
        inputModalities: [],
        outputModalities: [],
        pricing: { input: 2, output: 8 },
      }),
    });
    expect(projected.ModelProviders[0]?.Pricing).toEqual({ input: 0, output: 8 });
    expect(config.ModelProviders[0]?.Pricing).toEqual({ input: 0 });
  });
});
