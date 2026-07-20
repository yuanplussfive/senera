import { describe, expect, test } from "vitest";
import {
  AgentModelUsageLedger,
  AgentModelUsageResolver,
  createProviderReportedUsage,
} from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";

describe("agent model usage", () => {
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
      stage: "selectPiAction",
      usage: {
        source: "provider_reported",
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
      },
    });
    ledger.record({
      stage: "generatePiFinalAnswer",
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
      source: "mixed",
      inputTokens: 230,
      outputTokens: 30,
      totalTokens: 260,
      estimatedFields: ["outputTokens", "totalTokens"],
      calls: [
        expect.objectContaining({ stage: "selectPiAction" }),
        expect.objectContaining({ stage: "generatePiFinalAnswer" }),
      ],
    });
  });
});
