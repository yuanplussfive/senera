import { describe, expect, test } from "vitest";
import { recallAgentContinuityGraph } from "../../../Source/AgentSystem/Continuity/AgentContinuityGraphRecall.js";
import { getAgentContinuityRelationDefinition } from "../../../Source/AgentSystem/Continuity/AgentContinuityRelationCatalog.js";
import { AgentContinuityRecallRankingDefaults } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallDefaults.js";
import { AgentContinuityTextSimilarity } from "../../../Source/AgentSystem/Continuity/AgentContinuityTextSimilarity.js";
import type {
  AgentContinuityGraphEntity,
  AgentContinuityGraphRelation,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityGraphTypes.js";

const scope = { kind: "workspace" as const, id: "workspace" };
const now = new Date("2026-08-27T08:00:00+08:00");

describe("continuity graph recall", () => {
  test("uses a direct relationship intent to prioritize the matching one-hop edge", () => {
    const eventUri = "senera://continuity-concept/event";
    const result = recallAgentContinuityGraph({
      query: "周末球赛安排在什么时候",
      entities: [
        entity(eventUri, "周末球赛", "event"),
        entity("senera://continuity-concept/time", "下周六", "time"),
        entity("senera://continuity-concept/weather", "天气", "topic"),
      ],
      relations: [
        relation(eventUri, "senera://continuity-concept/weather", "depends_on"),
        relation(eventUri, "senera://continuity-concept/time", "scheduled_for"),
      ],
      anchorUris: [eventUri],
      preferredRelationIds: ["scheduled_for"],
      similarity: new AgentContinuityTextSimilarity(AgentContinuityRecallRankingDefaults.Similarity),
      now,
      minimumScore: AgentContinuityRecallRankingDefaults.CandidateScore,
      maxEntries: 1,
      maxHops: 1,
    });

    expect(result.relations).toEqual([expect.objectContaining({ relationId: "scheduled_for", object: "下周六" })]);
    expect(result.matchedRelationUris).toEqual(["senera://continuity-relation/scheduled_for"]);
  });

  test("applies the configured hop bound and decays each additional path step", () => {
    const startUri = "senera://continuity-concept/start";
    const middleUri = "senera://continuity-concept/middle";
    const endUri = "senera://continuity-concept/end";
    const entities = [
      entity(startUri, "起点", "event"),
      entity(middleUri, "中间事件", "event"),
      entity(endUri, "终点事件", "event"),
    ];
    const relations = [
      relation(startUri, middleUri, "depends_on", "start-middle"),
      relation(middleUri, endUri, "depends_on", "middle-end"),
    ];

    const oneHop = recallAgentContinuityGraph({
      query: "起点",
      entities,
      relations,
      anchorUris: [startUri],
      similarity: new AgentContinuityTextSimilarity(AgentContinuityRecallRankingDefaults.Similarity),
      now,
      minimumScore: AgentContinuityRecallRankingDefaults.CandidateScore,
      maxEntries: 10,
      maxHops: 1,
    });
    const twoHops = recallAgentContinuityGraph({
      query: "起点",
      entities,
      relations,
      anchorUris: [startUri],
      similarity: new AgentContinuityTextSimilarity(AgentContinuityRecallRankingDefaults.Similarity),
      now,
      minimumScore: AgentContinuityRecallRankingDefaults.CandidateScore,
      maxEntries: 10,
      maxHops: 2,
    });

    expect(oneHop.matchedRelationUris).toEqual(["senera://continuity-relation/start-middle"]);
    expect(twoHops.matchedRelationUris).toEqual([
      "senera://continuity-relation/start-middle",
      "senera://continuity-relation/middle-end",
    ]);
  });
});

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
  relationId: AgentContinuityGraphRelation["relationId"],
  relationKey = relationId,
): AgentContinuityGraphRelation {
  const definition = getAgentContinuityRelationDefinition(relationId);
  return {
    id: relationKey,
    uri: `senera://continuity-relation/${relationKey}`,
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
    maturity: "active",
    status: "active",
    supersededBy: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}
