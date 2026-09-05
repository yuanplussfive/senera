import { describe, expect, test } from "vitest";
import { AgentContinuityRecordRanker } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecordRanker.js";
import { AgentContinuityRecallIndex } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallIndex.js";
import { AgentContinuityRecallRankingDefaults } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallDefaults.js";
import { AgentContinuityTextSimilarity } from "../../../Source/AgentSystem/Continuity/AgentContinuityTextSimilarity.js";
import type { AgentContinuityObservation } from "../../../Source/AgentSystem/Continuity/AgentContinuityDomain.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../../../Source/AgentSystem/Types/AgentToolAndMemoryConfigTypes.js";

const now = new Date("2026-08-25T00:00:00.000Z");

describe("continuity recall quality", () => {
  test("surfaces near misses and rejection diagnostics alongside ranked records", () => {
    const policy = policyWith({ CandidateScore: 2 });
    const ranker = new AgentContinuityRecordRanker(policy);
    const exactReference = observation("exact", "用户住在上海。", { watermark: "无糖咖啡" });
    const moderate = observation("moderate", "用户喜欢无糖咖啡。");
    const unrelated = observation("unrelated", "用户喜欢低饱和绿色界面。");

    const result = ranker.rank({ query: "无糖咖啡", observations: [exactReference, moderate, unrelated], now });

    expect(result.records.map((record) => record.observation.uri)).toEqual([exactReference.uri]);
    expect(result.records[0]?.matchedBy).toContain("exact_ref");
    expect(result.records[0]?.projection).toBe("direct");

    expect(result.nearMisses).toHaveLength(1);
    const nearMiss = result.nearMisses[0]!;
    expect(nearMiss.observation.uri).toBe(moderate.uri);
    expect(nearMiss.score).toBeGreaterThan(0);
    expect(nearMiss.score).toBeLessThan(policy.CandidateScore);
    expect(nearMiss.textSimilarityScore).toBeGreaterThanOrEqual(0);
    expect(nearMiss.lexicalScore).toBeGreaterThan(0);
    expect(nearMiss.semanticScore).toBe(0);
    expect(nearMiss.matchedBy).toContain("lexical");

    expect(result.rejections).toEqual({ belowSimilarity: 1, belowCandidate: 1, funnelSkipped: 0 });
  });

  test("caps near miss entries and keeps them ordered by score", () => {
    const ranker = new AgentContinuityRecordRanker(
      policyWith({ CandidateScore: 2, NearMiss: { MaxEntries: 2, MinimumScore: 0.15 } }),
    );
    const observations = [
      observation("coffee", "用户喜欢无糖咖啡。"),
      observation("latte", "用户偶尔喝拿铁咖啡。"),
      observation("brew", "用户自己手冲咖啡。"),
    ];

    const result = ranker.rank({ query: "咖啡偏好", observations, now });

    expect(result.records).toHaveLength(0);
    expect(result.rejections.belowCandidate).toBe(observations.length);
    expect(result.nearMisses).toHaveLength(2);
    expect(result.nearMisses[0]!.score).toBeGreaterThanOrEqual(result.nearMisses[1]!.score);
  });

  test("the scale funnel keeps the lexical head and exact references", () => {
    const ranker = new AgentContinuityRecordRanker(
      policyWith({ Funnel: { MinimumObservations: 3, MaxLexicalCandidates: 1 } }),
    );
    const exactReference = observation("exact", "用户住在上海。", { watermark: "咖啡偏好" });
    const observations = [
      observation("coffee", "用户喜欢无糖咖啡。"),
      observation("latte", "用户偶尔喝拿铁咖啡。"),
      observation("brew", "用户自己手冲咖啡。"),
      exactReference,
    ];

    const result = ranker.rank({ query: "咖啡偏好", observations, now });

    const rankedUris = result.records.map((record) => record.observation.uri);
    expect(rankedUris).toContain(exactReference.uri);
    // The funnel keeps the lexical head plus exact-reference exemptions;
    // every coffee observation shares the 咖啡 term, so only the lexical
    // winner and the exact reference survive the MaxLexicalCandidates: 1 cap.
    expect(result.rejections.funnelSkipped).toBe(3);
    expect(result.rejections.funnelSkipped + result.records.length + result.rejections.belowCandidate).toBe(
      observations.length,
    );
  });

  test("does not apply the funnel below the configured observation count", () => {
    const ranker = new AgentContinuityRecordRanker(
      policyWith({ Funnel: { MinimumObservations: 10, MaxLexicalCandidates: 1 } }),
    );
    const observations = [
      observation("coffee", "用户喜欢无糖咖啡。"),
      observation("latte", "用户偶尔喝拿铁咖啡。"),
      observation("brew", "用户自己手冲咖啡。"),
    ];

    const result = ranker.rank({ query: "咖啡偏好", observations, now });

    expect(result.rejections.funnelSkipped).toBe(0);
    expect(result.records.length + result.rejections.belowCandidate).toBe(observations.length);
  });

  test("semantic evidence promotes records through the embedding channel", () => {
    const semanticOnly = semanticOnlyPolicy();
    const ranker = new AgentContinuityRecordRanker(semanticOnly);
    const observations = [observation("coffee", "用户喜欢无糖咖啡。")];

    const withoutSemantic = ranker.rank({ query: "无糖咖啡", observations, now });
    expect(withoutSemantic.records).toHaveLength(0);
    expect(withoutSemantic.rejections.belowCandidate).toBe(1);

    const withSemantic = ranker.rank({
      query: "无糖咖啡",
      observations,
      now,
      semanticScores: new Map([[observations[0]!.uri, 0.9]]),
    });
    expect(withSemantic.records).toHaveLength(1);
    expect(withSemantic.records[0]?.semanticScore).toBe(0.9);
    expect(withSemantic.records[0]?.matchedBy).toContain("embedding");
    expect(withSemantic.records[0]?.score).toBe(0.9);
  });

  test("preserves fuzzy lexical evidence after the broad-phase index matches", () => {
    const index = new AgentContinuityRecallIndex(new AgentContinuityTextSimilarity());
    const entry = observation("shanghai", "用户住在上海市。");

    const scores = index.scores("上海", [entry]);

    expect(scores.get(entry.uri)).toBeGreaterThan(0);
  });

  test("bridges CJK compound wording through search fragments", () => {
    const ranker = new AgentContinuityRecordRanker();
    const observations = [observation("coffee", "用户喜欢无糖咖啡。"), observation("residence", "用户住在上海。")];

    expect(
      ranker.rank({ query: "我想喝咖啡", observations, now }).records.map((record) => record.observation.uri),
    ).toContain("senera://continuity-learning/coffee");
    expect(
      ranker.rank({ query: "他住在哪里", observations, now }).records.map((record) => record.observation.uri),
    ).toContain("senera://continuity-learning/residence");
  });

  test("semantic candidates remain eligible when the lexical channel has no hit", () => {
    const ranker = new AgentContinuityRecordRanker(
      semanticOnlyPolicy({ Funnel: { MinimumObservations: 512, MaxLexicalCandidates: 1 } }),
    );
    const observations = Array.from({ length: 512 }, (_, index) =>
      observation(`record-${index}`, `完全不同的事实 ${index}`),
    );
    const target = observations[511]!;

    const result = ranker.rank({
      query: "用户的居住地点",
      observations,
      now,
      semanticScores: new Map([[target.uri, 0.9]]),
    });

    expect(result.records.map((record) => record.observation.uri)).toEqual([target.uri]);
    expect(result.rejections.funnelSkipped).toBe(511);
  });

  test("does not let ineligible records consume the lexical funnel", () => {
    const ranker = new AgentContinuityRecordRanker(
      policyWith({ Funnel: { MinimumObservations: 1, MaxLexicalCandidates: 1 } }),
    );
    const expired = [
      observation("expired-a", "目标事实", { payload: { kind: "fact", until: "2020-01-01T00:00:00.000Z" } }),
      observation("expired-b", "目标事实", { payload: { kind: "fact", until: "2020-01-02T00:00:00.000Z" } }),
    ];
    const valid = observation("valid", "目标事实", { payload: { kind: "fact", until: "permanent" } });
    const unrelated = [observation("other-a", "完全不同的内容"), observation("other-b", "另一条无关内容")];

    const result = ranker.rank({ query: "目标事实", observations: [...expired, valid, ...unrelated], now });

    expect(result.records.map((record) => record.observation.uri)).toContain(valid.uri);
    expect(result.rejections.funnelSkipped).toBeGreaterThan(0);
  });

  test("an empty query produces empty diagnostics", () => {
    const result = new AgentContinuityRecordRanker().rank({
      query: "   ",
      observations: [observation("coffee", "用户喜欢无糖咖啡。")],
      now,
    });
    expect(result).toEqual({
      records: [],
      nearMisses: [],
      rejections: { belowSimilarity: 0, belowCandidate: 0, funnelSkipped: 0 },
    });
  });
});

function semanticOnlyPolicy(
  overrides: Partial<ResolvedAgentContinuityRecallRankingConfig> = {},
): ResolvedAgentContinuityRecallRankingConfig {
  return policyWith({
    Weights: {
      TextSimilarity: 0,
      Lexical: 0,
      Confidence: 0,
      Authority: 0,
      Scope: 0,
      Recency: 0,
      Semantic: 1,
    },
    ...overrides,
  });
}

function policyWith(
  overrides: Partial<ResolvedAgentContinuityRecallRankingConfig>,
): ResolvedAgentContinuityRecallRankingConfig {
  return { ...AgentContinuityRecallRankingDefaults, ...overrides };
}

function observation(
  id: string,
  summary: string,
  overrides: Partial<AgentContinuityObservation> = {},
): AgentContinuityObservation {
  return {
    id,
    uri: `senera://continuity-learning/${id}`,
    kind: "learning.record",
    summary,
    payload: { kind: "fact", summary, until: "permanent" },
    sourceRefs: [`senera://memory-source/${id}`],
    watermark: `wm-${id}`,
    scope: { kind: "workspace", id: "workspace" },
    authority: "user_explicit",
    confidence: 1,
    occurredAt: "2026-08-24T01:00:00.000Z",
    observedAt: "2026-08-24T01:00:01.000Z",
    createdAtMs: Date.parse("2026-08-24T01:00:01.000Z"),
    ...overrides,
  };
}
