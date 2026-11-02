import { describe, expect, test } from "vitest";
import {
  AgentModelUsageLedger,
  AgentModelUsageResolver,
  createProviderReportedUsage,
} from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";

describe("agent model usage", () => {
  test("preserves billed charges and response identity while estimating missing token fields", () => {
    const resolver = new AgentModelUsageResolver("virtual-model", { input: 1, output: 2 });
    const usage = resolver.resolve({ messages: [] }, "A result", {
      source: "provider_reported",
      inputTokens: 120,
      responseModel: "serving-model",
      cost: { currency: "USD", total: 0.75, totalFromProvider: true },
    });
    expect(usage).toMatchObject({
      source: "mixed",
      responseModel: "serving-model",
      cost: { total: 0.75, totalFromProvider: true },
    });
    const ledger = new AgentModelUsageLedger();
    ledger.record({ stage: "call", usage });
    usage.cost = { currency: "USD", total: 1 };
    expect(ledger.aggregate()).toMatchObject({
      cost: { total: 0.75, totalFromProvider: true },
      calls: [{ usage: { responseModel: "serving-model" } }],
    });
    expect(ledger.aggregate()?.responseModel).toBeUndefined();
  });

  test("normalizes provider values and rejects invalid token counts", () => {
    expect(
      createProviderReportedUsage({
        inputTokens: -1,
        outputTokens: 7.9,
        totalTokens: Number.NaN,
        cacheReadTokens: 3,
      }),
    ).toEqual({
      source: "provider_reported",
      outputTokens: 7,
      totalTokens: undefined,
      cacheReadTokens: 3,
    });
  });

  test("estimates only missing provider fields and records their provenance", () => {
    const resolver = new AgentModelUsageResolver("gpt-4o");
    const reported = createProviderReportedUsage({
      inputTokens: 120,
      cacheReadTokens: 30,
    });

    const usage = resolver.resolve(
      {
        systemPrompt: "Follow policy.",
        messages: [{ role: "user", content: "Explain the result." }],
      },
      "The result is verified.",
      reported,
    );

    expect(usage).toMatchObject({
      source: "mixed",
      inputTokens: 120,
      cacheReadTokens: 30,
      estimatedFields: ["outputTokens", "totalTokens"],
    });
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBe(120 + 30 + usage.outputTokens!);
  });

  test("aggregates billable calls while selecting one context-safe usage value", () => {
    const ledger = new AgentModelUsageLedger();
    ledger.record({
      stage: "prepareTurn",
      usage: {
        source: "provider_reported",
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
      },
    });
    ledger.record({
      stage: "evolveTurn",
      usage: {
        source: "mixed",
        inputTokens: 130,
        outputTokens: 20,
        totalTokens: 150,
        estimatedFields: ["outputTokens", "totalTokens"],
      },
    });

    expect(ledger.contextUsage()).toMatchObject({ inputTokens: 130, totalTokens: 150 });
    expect(ledger.aggregate()).toEqual({
      cost: { currency: "USD" },
      source: "mixed",
      inputTokens: 230,
      outputTokens: 30,
      totalTokens: 260,
      estimatedFields: ["outputTokens", "totalTokens"],
      calls: [expect.objectContaining({ stage: "prepareTurn" }), expect.objectContaining({ stage: "evolveTurn" })],
    });
  });

  test("forwards nested provider calls to the owning turn once", () => {
    const turn = new AgentModelUsageLedger();
    const sidecar = turn.fork();
    sidecar.record({
      stage: "imageAnalyze",
      usage: { source: "provider_reported", inputTokens: 40, outputTokens: 6, totalTokens: 46 },
    });

    expect(sidecar.aggregate()).toMatchObject({ inputTokens: 40, outputTokens: 6, totalTokens: 46 });
    expect(turn.aggregate()).toMatchObject({ inputTokens: 40, outputTokens: 6, totalTokens: 46 });
    expect(turn.aggregate()?.calls).toHaveLength(1);
  });
});
