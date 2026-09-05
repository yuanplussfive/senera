import { describe, expect, test } from "vitest";
import {
  assessAgentContinuityRecallQuality,
  buildAgentContinuityContextVariant,
  buildAgentContinuityFeedbackVariant,
  isAgentContinuityRecallQualityImproved,
  preservesAgentContinuityRecallBaseline,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallCascade.js";
import type { AgentContinuityObservation } from "../../../Source/AgentSystem/Continuity/AgentContinuityDomain.js";
import type {
  AgentContinuityNearMissRecord,
  AgentContinuityRankedRecord,
  AgentContinuityRankResult,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityRecordRanker.js";
import { AgentContinuityTextSimilarity } from "../../../Source/AgentSystem/Continuity/AgentContinuityTextSimilarity.js";

describe("continuity adaptive recall cascade", () => {
  test("deduplicates cross-view candidates and records direct versus expansion evidence", () => {
    const shared = ranked("shared", 0.8, 0.7, ["text_similarity"]);
    const expansion = ranked("expansion", 0.6, 0, ["lexical"]);
    const quality = assessAgentContinuityRecallQuality([result([shared, expansion]), result([shared])], {
      minimumTextSimilarityScore: 0.12,
    });

    expect(quality).toMatchObject({
      acceptedCount: 2,
      candidateCount: 2,
      directEvidenceCount: 1,
      expansionOnlyCount: 1,
    });
  });

  test("rejects an expansion that weakens an equally grounded baseline", () => {
    const baseline = assessAgentContinuityRecallQuality([result([ranked("direct", 0.9, 0.8, ["text_similarity"])])], {
      minimumTextSimilarityScore: 0.12,
    });
    const distractor = assessAgentContinuityRecallQuality(
      [result([ranked("direct", 0.9, 0.8, ["text_similarity"]), ranked("distractor", 0.85, 0.05, ["lexical"])])],
      { minimumTextSimilarityScore: 0.12 },
    );

    expect(isAgentContinuityRecallQualityImproved(distractor, baseline)).toBe(false);
  });

  test("does not trade a decisive baseline for a wider but ambiguous set", () => {
    const baseline = assessAgentContinuityRecallQuality([result([ranked("direct", 0.9, 0.8, ["text_similarity"])])], {
      minimumTextSimilarityScore: 0.12,
    });
    const wider = assessAgentContinuityRecallQuality(
      [result([ranked("direct", 0.9, 0.8, ["text_similarity"]), ranked("new-direct", 0.9, 0.8, ["text_similarity"])])],
      { minimumTextSimilarityScore: 0.12 },
    );

    expect(isAgentContinuityRecallQualityImproved(wider, baseline)).toBe(false);
  });

  test("does not treat additional near misses as a quality improvement", () => {
    const baseline = assessAgentContinuityRecallQuality([result([])], { minimumTextSimilarityScore: 0.12 });
    const noisy = assessAgentContinuityRecallQuality(
      [
        {
          ...result([]),
          nearMisses: [nearMiss("weak", 0.2)],
        },
      ],
      { minimumTextSimilarityScore: 0.12 },
    );

    expect(isAgentContinuityRecallQualityImproved(noisy, baseline)).toBe(false);
  });

  test("keeps every grounded baseline score from being diluted by an expansion", () => {
    const first = ranked("first", 0.9, 0.8, ["text_similarity"]);
    const second = ranked("second", 0.7, 0.6, ["text_similarity"]);
    const weakenedSecond = ranked("second", 0.5, 0.6, ["text_similarity"]);

    expect(
      preservesAgentContinuityRecallBaseline([result([first, second])], [result([first, weakenedSecond])], 0.12),
    ).toBe(false);
  });

  test("does not let an expansion-only record displace a grounded lead", () => {
    const direct = ranked("direct", 0.8, 0.8, ["text_similarity"]);
    const expansion = ranked("expansion", 0.95, 0, ["lexical"]);

    expect(preservesAgentContinuityRecallBaseline([result([direct])], [result([expansion, direct])], 0.12)).toBe(false);
  });

  test("accepts the first grounded candidate when baseline is empty", () => {
    const empty = assessAgentContinuityRecallQuality([result([])], { minimumTextSimilarityScore: 0.12 });
    const recovered = assessAgentContinuityRecallQuality(
      [result([ranked("recovered", 0.5, 0.4, ["text_similarity"])])],
      { minimumTextSimilarityScore: 0.12 },
    );

    expect(isAgentContinuityRecallQualityImproved(recovered, empty)).toBe(true);
  });

  test("keeps context variants bounded and removes terms already in the request", () => {
    const variant = buildAgentContinuityContextVariant({
      query: "那个项目怎么样",
      contexts: ["上次讨论 Senera 项目的部署计划和数据库迁移"],
      similarity: new AgentContinuityTextSimilarity(),
      maxTerms: 3,
      maxCharacters: 30,
    });

    expect(variant).toBeDefined();
    expect(variant?.addedTerms).not.toContain("那个");
    expect([...variant!.query].length).toBeLessThanOrEqual(30);
  });

  test("uses only lexical seeds for feedback", () => {
    const semanticOnly = ranked("semantic", 0.9, 0, ["embedding"], "完全不同的语义结果");
    const lexicalSeed = ranked("lexical", 0.8, 0.6, ["lexical"], "项目已经完成部署和迁移。");
    const variant = buildAgentContinuityFeedbackVariant({
      query: "项目进度",
      seeds: [semanticOnly, lexicalSeed],
      corpus: [observation("lexical", "项目已经完成部署和迁移。")],
      similarity: new AgentContinuityTextSimilarity(),
      maxSeedRecords: 2,
      maxTerms: 4,
      maxCharacters: 50,
      minSeedScore: 0.2,
    });

    expect(variant).toBeDefined();
    expect(variant?.addedTerms).toContain("部署");
    expect(variant?.addedTerms).not.toContain("semantic");
  });
});

function result(records: readonly AgentContinuityRankedRecord[]): AgentContinuityRankResult {
  return {
    records,
    nearMisses: [],
    rejections: { belowSimilarity: 0, belowCandidate: 0, funnelSkipped: 0 },
  };
}

function ranked(
  id: string,
  score: number,
  textSimilarityScore: number,
  matchedBy: AgentContinuityRankedRecord["matchedBy"],
  summary = id,
): AgentContinuityRankedRecord {
  return {
    observation: observation(id, summary),
    score,
    textSimilarityScore,
    lexicalScore: matchedBy.includes("lexical") ? 0.5 : 0,
    semanticScore: matchedBy.includes("embedding") ? 0.9 : 0,
    matchedBy,
    projection: textSimilarityScore > 0 ? "direct" : "reference",
  };
}

function nearMiss(id: string, score: number): AgentContinuityNearMissRecord {
  const record = ranked(id, score, score, ["text_similarity"]);
  return {
    observation: record.observation,
    score: record.score,
    textSimilarityScore: record.textSimilarityScore,
    lexicalScore: record.lexicalScore,
    semanticScore: record.semanticScore,
    matchedBy: record.matchedBy,
  };
}

function observation(id: string, summary: string): AgentContinuityObservation {
  return {
    id,
    uri: `senera://continuity-learning/${id}`,
    kind: "learning.record",
    summary,
    payload: { kind: "fact", fact: summary, until: "permanent" },
    sourceRefs: [`source-${id}`],
    watermark: `wm-${id}`,
    scope: { kind: "workspace", id: "workspace" },
    authority: "user_explicit",
    confidence: 1,
    occurredAt: "2026-08-25T00:00:00.000Z",
    observedAt: "2026-08-25T00:00:00.000Z",
    createdAtMs: Date.parse("2026-08-25T00:00:00.000Z"),
  };
}
