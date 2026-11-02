import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createAgentMemoryRelevanceAssessment } from "../../../Source/AgentSystem/Continuity/AgentMemoryRelevanceModel.js";
import {
  agentMemoryQualityWeight,
  agentMemoryRelevance,
} from "../../../Source/AgentSystem/Continuity/AgentMemoryRecallRanking.js";
import type { AgentContinuityEventCandidate } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryTypes.js";
import { AgentStructuredModelClient } from "../../../Source/AgentSystem/ModelEndpoints/AgentStructuredModelClient.js";
import { AgentBackgroundLearningRequestLedger } from "../../../Source/AgentSystem/Memory/AgentBackgroundLearningRequestLedger.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentModelTokenEstimator } from "../../../Source/AgentSystem/Text/AgentTextBudget.js";
import { createModelProvider, createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) close();
});
const quality = {
  weight: 50,
  recallCount: 0,
  helpfulCount: 0,
  unhelpfulCount: 0,
  unusedCount: 0,
  uncertainCount: 0,
  pendingCount: 0,
};
const candidate = (id: string, summary = "Source-backed project fact"): AgentContinuityEventCandidate => ({
  id,
  uri: `memos:${id}`,
  revision: id,
  type: "fact",
  summary,
  occurredAt: "2026-10-27T00:00:00Z",
  score: 0.9,
  matchedBy: ["memos", "hybrid"],
  quality,
  scores: { keyword: 0.8, semantic: 0.6, hybrid: 0.9 },
});
function fixture(mode: "native" | "baml" = "native", maxInputTokens = 4096) {
  const directory = createTemporaryDirectory("senera-memory-relevance");
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: path.join(directory, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  cleanup.push(() => {
    kernel.close();
    removeDirectory(directory);
  });
  const learningRequests = new AgentBackgroundLearningRequestLedger(kernel);
  const model = createModelProvider({
    Model: "gpt-4o",
    ToolPlanningMode: mode,
    ContextWindowTokens: 8192,
    MaxOutputTokens: 512,
  });
  const create = () =>
    createAgentMemoryRelevanceAssessment({
      model: () => model,
      scopeKey: "agent",
      learningRequests,
      maxInputTokens: () => maxInputTokens,
    });
  return { assess: create(), create, learningRequests, model };
}

describe("bounded semantic relevance before quality ranking", () => {
  test.each(["native", "baml"] as const)(
    "%s contract gates unrelated memories and reuses durable assessments",
    async (mode) => {
      const f = fixture(mode);
      const execute = vi.spyOn(AgentStructuredModelClient.prototype, "execute").mockResolvedValue({
        records: [
          { recordId: 0, relevant: true, score: 0.8 },
          { recordId: 1, relevant: false, score: 0.1 },
        ],
      });
      const input = { query: "Fix the current project", candidates: [candidate("relevant"), candidate("irrelevant")] };
      const selected = await f.assess(input);
      expect(selected.map((entry) => entry.id)).toEqual(["relevant"]);
      expect(selected[0]?.score).toBeCloseTo(0.4);
      expect(selected[0]?.scores?.relevance).toBe(0.8);
      expect(execute.mock.calls[0]![0].contract.bamlFunction).toBe("AssessMemoryRelevance");
      expect(await f.create()(input)).toEqual(selected);
      expect(execute).toHaveBeenCalledOnce();
      f.model.Model = "another-model";
      await f.assess(input);
      expect(execute).toHaveBeenCalledTimes(2);
      const schema = execute.mock.calls[0]![0].contract.schema;
      for (const records of [
        [],
        [{ recordId: 0, relevant: true, score: 0.8 }],
        [
          { recordId: 0, relevant: true, score: 0.8 },
          { recordId: 0, relevant: false, score: 0 },
        ],
        [
          { recordId: 0, relevant: true, score: 0.8 },
          { recordId: 2, relevant: false, score: 0 },
        ],
        [
          { recordId: 0, relevant: true, score: 0 },
          { recordId: 1, relevant: false, score: 0 },
        ],
      ]) {
        expect(schema.safeParse({ records }).success).toBe(false);
      }
    },
  );

  test("batches by the configured model token budget without truncating source records", async () => {
    const f = fixture("native", 1000);
    const execute = vi.spyOn(AgentStructuredModelClient.prototype, "execute").mockImplementation(async (request) => {
      const input = JSON.parse(request.userPrompt) as { records: Array<{ recordId: number }> };
      return request.contract.schema.parse({
        records: input.records.map(({ recordId }) => ({ recordId, relevant: true, score: 0.75 })),
      });
    });
    const candidates = Array.from({ length: 24 }, (_, index) =>
      candidate(String(index), "Verified observation. ".repeat(40)),
    );
    expect(await f.assess({ query: "Inspect the observations", candidates })).toHaveLength(24);
    expect(execute.mock.calls.length).toBeGreaterThan(1);
    const estimator = new AgentModelTokenEstimator({ model: f.model.Model });
    for (const [request] of execute.mock.calls) {
      const overhead = estimator.estimate(
        request.systemPrompt +
          JSON.stringify(z.toJSONSchema(request.contract.schema, { io: "input", target: "draft-7" })),
      ).tokenCount;
      expect(overhead + estimator.estimate(request.userPrompt).tokenCount).toBeLessThanOrEqual(1000);
    }
  });

  test("does not manufacture relevance for an empty query or truncate an oversized record", async () => {
    const f = fixture("native", 1000);
    const execute = vi.spyOn(AgentStructuredModelClient.prototype, "execute");
    expect(await f.assess({ query: "", candidates: [candidate("empty-query")] })).toEqual([]);
    await expect(
      f.assess({ query: "Fix it", candidates: [candidate("oversized", "detailed observation ".repeat(3000))] }),
    ).rejects.toThrow("cannot fit");
    expect(execute).not.toHaveBeenCalled();
  });

  test("never uses the SDK trust-weighted hybrid score as another confidence factor", () => {
    const memory = { score: 0.999, scores: { keyword: 0.8, semantic: 0.6, hybrid: 0.999 } };
    const changedTrust = { ...memory, score: 0.2, scores: { ...memory.scores, hybrid: 0.2 } };
    // These functions consume scores only; no storage or protocol conversion is involved.
    expect(agentMemoryRelevance(memory)).toBeCloseTo(0.7);
    expect(agentMemoryRelevance(changedTrust)).toBeCloseTo(0.7);
    expect(agentMemoryQualityWeight(quality)).toBeCloseTo(0.5);
  });
});
