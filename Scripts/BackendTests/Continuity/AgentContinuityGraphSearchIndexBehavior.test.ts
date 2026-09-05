import { describe, expect, test } from "vitest";
import type { AgentContinuityConceptRecord } from "../../../Source/AgentSystem/Continuity/AgentContinuityConceptCatalog.js";
import { AgentContinuityGraphSearchIndex } from "../../../Source/AgentSystem/Continuity/AgentContinuityGraphSearchIndex.js";
import type {
  AgentContinuityGraphEntity,
  AgentContinuityGraphSnapshot,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityGraphTypes.js";
import { AgentContinuityRecallRankingDefaults } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallDefaults.js";
import { AgentContinuityTextSimilarity } from "../../../Source/AgentSystem/Continuity/AgentContinuityTextSimilarity.js";

const scope = { kind: "workspace" as const, id: "workspace" };
const nowMs = Date.parse("2026-08-28T00:00:00.000Z");

describe("continuity graph search index", () => {
  test("uses lexical candidate retrieval before bounded concept scoring", () => {
    const index = createIndex();
    const selected = index.select({
      query: "那个项目现在怎么样",
      concepts: [concept("project", "Senera 项目", ["senera", "项目"]), concept("weather", "天气")],
      graph: graph([entity("event", "周末球赛", "event"), entity("place", "上海", "place")]),
      nowMs,
      cacheTtlMs: 60_000,
      maxConcepts: 1,
      maxEntities: 1,
    });

    expect(selected.concepts.map((entry) => entry.label)).toEqual(["Senera 项目"]);
    expect(selected.entities).toEqual([]);
    expect(selected.vocabulary.isInformative("项目")).toBe(true);
  });

  test("keeps entity candidates independently bounded", () => {
    const selected = createIndex().select({
      query: "球赛时间",
      concepts: [],
      graph: graph([entity("event", "周末球赛", "event"), entity("time", "下周六", "time")]),
      nowMs,
      cacheTtlMs: 60_000,
      maxConcepts: 0,
      maxEntities: 1,
    });

    expect(selected.entities).toHaveLength(1);
    expect(selected.entities[0]).toMatchObject({ label: "周末球赛" });
  });

  test("does not evict a warmed snapshot for a non-caching request", () => {
    const index = createIndex();
    const input = {
      query: "项目",
      concepts: [concept("project", "Senera 项目", ["项目"])],
      graph: graph([]),
      nowMs,
      maxConcepts: 1,
      maxEntities: 0,
    };

    const warmed = index.select({ ...input, cacheTtlMs: 60_000 });
    index.select({ ...input, nowMs: nowMs + 1, cacheTtlMs: 0 });
    const reused = index.select({ ...input, nowMs: nowMs + 2, cacheTtlMs: 60_000 });

    expect(reused.vocabulary).toBe(warmed.vocabulary);
  });
});

function createIndex(): AgentContinuityGraphSearchIndex {
  return new AgentContinuityGraphSearchIndex(
    new AgentContinuityTextSimilarity(AgentContinuityRecallRankingDefaults.Similarity),
  );
}

function graph(entities: readonly AgentContinuityGraphEntity[]): AgentContinuityGraphSnapshot {
  return { scope: [scope], entities, relations: [] };
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
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}

function entity(id: string, label: string, kind: AgentContinuityGraphEntity["kind"]): AgentContinuityGraphEntity {
  return {
    uri: `senera://continuity-concept/${id}`,
    label,
    aliases: [],
    kind,
    scope,
    status: "active",
    mergedIntoUri: null,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}
