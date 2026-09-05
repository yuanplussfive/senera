import { describe, expect, test } from "vitest";
import type { AgentContinuityConceptRecord } from "../../../Source/AgentSystem/Continuity/AgentContinuityConceptCatalog.js";
import type {
  AgentContinuityGraphEntity,
  AgentContinuityGraphRelation,
  AgentContinuityGraphSnapshot,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityGraphTypes.js";
import { getAgentContinuityRelationDefinition } from "../../../Source/AgentSystem/Continuity/AgentContinuityRelationCatalog.js";
import { AgentContinuityRecallRankingDefaults } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallDefaults.js";
import { AgentContinuityTextSimilarity } from "../../../Source/AgentSystem/Continuity/AgentContinuityTextSimilarity.js";
import {
  createAgentContinuityRecallQueryPlan,
  projectAgentContinuityRecallQueryPlanAudit,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallQueryPlan.js";
import type { AgentContinuityTextSimilarity as AgentContinuityTextSimilarityType } from "../../../Source/AgentSystem/Continuity/AgentContinuityTextSimilarity.js";

const scope = { kind: "workspace" as const, id: "workspace" };
const now = new Date("2026-08-27T08:00:00+08:00");

describe("continuity local recall query plan", () => {
  test("resolves a direct alias without treating a fact catalog entry as a graph anchor", () => {
    const plan = createPlan({
      concepts: [concept("project", "Senera 项目", ["senera", "项目"])],
    });

    expect(plan.conceptMatches).toEqual([expect.objectContaining({ label: "Senera 项目", direct: true, score: 1 })]);
    expect(plan.anchorUris).toEqual([]);
    expect(plan.expandedQuery.split("\n")).toEqual(["那个项目现在怎么样", "Senera 项目"]);
  });

  test("rejects an accidental one-character overlap as a direct anchor", () => {
    const plan = createPlan({
      query: "下周六下午，我打算在徐汇滨江跑步，不过取决于天气，下雨就取消",
      graph: {
        scope: [scope],
        entities: [
          entity(
            "unrelated",
            "human 在不同自主程度下都保留 guardrails、审计轨迹和人工审批门;自动化是可切换选项。",
            "concept",
          ),
        ],
        relations: [],
      },
    });

    expect(plan.entityMatches).toEqual([]);
    expect(plan.anchorUris).toEqual([]);
    expect(plan.expandedQuery).toBe("下周六下午，我打算在徐汇滨江跑步，不过取决于天气，下雨就取消");
  });

  test("expands an active one-hop relation from a direct event anchor", () => {
    const eventUri = "senera://continuity-concept/event";
    const timeUri = "senera://continuity-concept/time";
    const plan = createPlan({
      graph: {
        scope: [scope],
        entities: [entity(eventUri, "周末球赛", "event"), entity(timeUri, "下周六", "time")],
        relations: [relation(eventUri, timeUri)],
      },
      query: "球赛时间",
    });

    expect(plan.anchorUris).toContain(eventUri);
    expect(plan.expandedQuery).toContain("安排在");
    expect(plan.expandedQuery).toContain("下周六");
  });

  test("does not use an unconfirmed relation as a recall expansion path", () => {
    const eventUri = "senera://continuity-concept/event";
    const timeUri = "senera://continuity-concept/time";
    const plan = createPlan({
      graph: {
        scope: [scope],
        entities: [entity(eventUri, "周末球赛", "event"), entity(timeUri, "下周六", "time")],
        relations: [relation(eventUri, timeUri, "candidate")],
      },
      query: "球赛时间",
    });

    expect(plan.expandedQuery).not.toContain("安排在");
    expect(plan.expandedQuery).not.toContain("下周六");
  });

  test("prioritizes a directly requested relation when an anchor has several one-hop edges", () => {
    const eventUri = "senera://continuity-concept/event";
    const timeUri = "senera://continuity-concept/time";
    const weatherUri = "senera://continuity-concept/weather";
    const plan = createPlan({
      graph: {
        scope: [scope],
        entities: [
          entity(eventUri, "周末球赛", "event"),
          entity(timeUri, "下周六", "time"),
          entity(weatherUri, "天气", "topic"),
        ],
        relations: [
          relation(eventUri, weatherUri, "active", "depends_on"),
          relation(eventUri, timeUri, "active", "scheduled_for"),
        ],
      },
      query: "周末球赛安排在什么时候",
      maxRelationMatches: 1,
    });

    expect(plan.relationMatches).toEqual(
      expect.arrayContaining([expect.objectContaining({ relationId: "scheduled_for", direct: true })]),
    );
    expect(plan.expandedQuery).toContain("下周六");
    expect(plan.expandedQuery).not.toContain("天气");
  });

  test("keeps a fuzzy-only match out of the expansion anchors", () => {
    const plan = createPlan({
      query: "Sneraa 怎么样",
      concepts: [concept("project", "Senera", ["Senera"])],
      similarity: {
        terms: () => [],
        contentTerms: () => [],
        compare: () => ({ score: 0.8, exact: 0, coverage: 0, fuzzy: 0.8 }),
      } as Pick<AgentContinuityTextSimilarityType, "compare" | "terms" | "contentTerms">,
    });

    expect(plan.conceptMatches).toEqual([expect.objectContaining({ direct: false, matchedBy: ["fuzzy"] })]);
    expect(plan.anchorUris).toEqual([]);
    expect(plan.expandedQuery).toBe("Sneraa 怎么样");
  });

  test("scores only the bounded candidates supplied by the graph index", () => {
    const plan = createAgentContinuityRecallQueryPlan({
      query: "那个项目现在怎么样",
      concepts: [concept("project", "Senera 项目", ["senera", "项目"])],
      graph: { scope: [scope], entities: [], relations: [] },
      similarity: new AgentContinuityTextSimilarity(AgentContinuityRecallRankingDefaults.Similarity),
      now,
      minimumScore: AgentContinuityRecallRankingDefaults.MinimumTextSimilarityScore,
      directScore: AgentContinuityRecallRankingDefaults.DirectTextSimilarityScore,
      maxConceptMatches: 16,
      maxEntityMatches: 16,
      maxRelationMatches: 8,
      candidates: {
        concepts: [],
        entities: [],
        vocabulary: { isInformative: () => true },
      },
    });

    expect(plan.conceptMatches).toEqual([]);
    expect(plan.anchorUris).toEqual([]);
    expect(plan.expandedQuery).toBe("那个项目现在怎么样");
  });

  test("projects explainable local diagnostics without exposing concept URIs", () => {
    const plan = createPlan({
      concepts: [concept("project", "Senera 项目", ["senera", "项目"])],
    });

    expect(projectAgentContinuityRecallQueryPlanAudit(plan)).toEqual({
      terms: expect.any(Array),
      concepts: [
        expect.objectContaining({
          label: "Senera 项目",
          direct: true,
          matchedBy: expect.arrayContaining(["token"]),
        }),
      ],
      entities: [],
      relations: [],
      anchorLabels: [],
      expanded: true,
    });
    expect(JSON.stringify(projectAgentContinuityRecallQueryPlanAudit(plan))).not.toContain("senera://");
  });

  test("rejects invalid score and result limits at the boundary", () => {
    expect(() => createPlan({ minimumScore: 1.1 })).toThrow(/minimum score/);
    expect(() => createPlan({ maxRelationMatches: -1 })).toThrow(/maxRelationMatches/);
  });
});

function createPlan(input: {
  query?: string;
  concepts?: readonly AgentContinuityConceptRecord[];
  graph?: AgentContinuityGraphSnapshot;
  minimumScore?: number;
  maxRelationMatches?: number;
  similarity?: Pick<AgentContinuityTextSimilarityType, "compare" | "terms" | "contentTerms">;
}) {
  return createAgentContinuityRecallQueryPlan({
    query: input.query ?? "那个项目现在怎么样",
    concepts: input.concepts ?? [],
    graph: input.graph ?? { scope: [scope], entities: [], relations: [] },
    similarity: input.similarity ?? new AgentContinuityTextSimilarity(AgentContinuityRecallRankingDefaults.Similarity),
    now,
    minimumScore: input.minimumScore ?? AgentContinuityRecallRankingDefaults.MinimumTextSimilarityScore,
    directScore: AgentContinuityRecallRankingDefaults.DirectTextSimilarityScore,
    maxConceptMatches: 16,
    maxEntityMatches: 16,
    maxRelationMatches: input.maxRelationMatches ?? 8,
  });
}

function concept(id: string, label: string, aliases: readonly string[] = []): AgentContinuityConceptRecord {
  return {
    uri: `senera://continuity-concept/${id}`,
    label,
    aliases,
    entityKind: "concept",
    scope,
    recordKinds: ["fact"],
    recordCount: 1,
    mergedIntoUri: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}

function entity(uri: string, label: string, kind: AgentContinuityGraphEntity["kind"]): AgentContinuityGraphEntity {
  return {
    uri,
    label,
    aliases: [],
    kind,
    scope,
    status: "active",
    mergedIntoUri: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}

function relation(
  subjectUri: string,
  objectUri: string,
  maturity: AgentContinuityGraphRelation["maturity"] = "active",
  relationId: AgentContinuityGraphRelation["relationId"] = "scheduled_for",
): AgentContinuityGraphRelation {
  const definition = getAgentContinuityRelationDefinition(relationId);
  return {
    id: `relation-${relationId}`,
    uri: `senera://continuity-relation/relation-${relationId}`,
    subjectUri,
    relationId,
    relationLabel: definition.label,
    objectUri,
    scope,
    cardinality: definition.cardinality,
    temporal: { kind: "persistent", timeZone: "Asia/Shanghai" },
    authority: "user_explicit",
    confidence: 1,
    sourceRefs: ["senera://memory-source/relation"],
    supportCount: 1,
    supportMass: 1,
    maturity,
    status: "active",
    supersededBy: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}
