import { describe, expect, test } from "vitest";
import { AgentModelTokenEstimator } from "../../../Source/AgentSystem/Text/AgentTextBudget.js";
import { splitByTokenBudget } from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticLearningSupport.js";

describe("MemOS semantic learning token projection", () => {
  test("projects an oversized digest entry before batching instead of failing the job", () => {
    const model = "test-model";
    const tokenBudget = 100;
    const entries = [
      {
        summary: "long detail ".repeat(500),
        type: "context",
        occurredAt: "2026-10-16T00:00:00Z",
      },
    ];

    const chunks = splitByTokenBudget(entries, tokenBudget, model);
    const estimator = new AgentModelTokenEstimator({ model });

    expect(chunks).toHaveLength(1);
    expect(estimator.estimate(JSON.stringify({ entries: chunks[0] })).tokenCount).toBeLessThanOrEqual(tokenBudget);
    expect(chunks[0]?.[0]?.summary).not.toBe(entries[0]!.summary);
  });
});
