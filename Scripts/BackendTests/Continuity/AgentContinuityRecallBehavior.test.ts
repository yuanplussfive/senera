import { describe, expect, test, vi } from "vitest";
import { AgentContinuityRecallIndex } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallIndex.js";
import { AgentContinuityRecallIndexDefaults } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallIndex.js";
import { AgentContinuityRecallCatalog } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallCatalog.js";
import { AgentContinuityEpisodeRecall } from "../../../Source/AgentSystem/Continuity/AgentContinuityEpisodeRecall.js";
import { decideAgentContinuityRecall } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallGate.js";
import { AgentContinuityTextSimilarity } from "../../../Source/AgentSystem/Continuity/AgentContinuityTextSimilarity.js";
import { AgentContinuityRecordRanker } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecordRanker.js";
import type { AgentContinuityObservation } from "../../../Source/AgentSystem/Continuity/AgentContinuityDomain.js";
import type {
  AgentMemoryEpisodeRecord,
  AgentMemorySourceRecord,
  AgentMemorySourceRepository,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { testContinuityIdentity } from "./AgentContinuityTestFixtures.js";

describe("continuity recall lifecycle", () => {
  test("gates only high-confidence classified unproductive prompts", () => {
    const config = { enabled: true };
    const classification = {
      label: "unproductive" as const,
      confidence: 0.95,
      trainedExamples: { valuable: 3, unproductive: 3 },
    };

    expect(decideAgentContinuityRecall(config, classification)).toEqual({
      shouldRecallText: false,
      reason: "unproductive_classified",
    });
    expect(decideAgentContinuityRecall(config)).toEqual({
      shouldRecallText: true,
      reason: "semantic",
    });
    expect(decideAgentContinuityRecall({ ...config, enabled: false })).toEqual({
      shouldRecallText: true,
      reason: "disabled",
    });
  });

  test("rebuilds the lexical index when observations change", () => {
    const index = new AgentContinuityRecallIndex(new AgentContinuityTextSimilarity());
    const first = [observation("one", "用户喜欢无糖咖啡。")];
    const second = [observation("two", "用户住在上海。")];

    expect(index.scores("无糖咖啡", first)).toHaveProperty("size", 1);
    expect(index.scores("上海", second)).toHaveProperty("size", 1);
    expect(index.scores("无糖咖啡", second)).toHaveProperty("size", 0);
  });

  test("shares one request-scoped snapshot across lexical query variants", () => {
    const index = new AgentContinuityRecallIndex(new AgentContinuityTextSimilarity());
    const entries = [observation("one", "用户喜欢无糖咖啡。"), observation("two", "用户住在上海。")];
    const session = index.openSession(entries);

    expect(session.scoresForQueries(["无糖咖啡", "上海", "无糖咖啡"])).toEqual([
      index.scores("无糖咖啡", entries),
      index.scores("上海", entries),
      index.scores("无糖咖啡", entries),
    ]);
    expect(session.vocabulary.isInformative("无糖咖啡")).toBe(true);
  });

  test("uses one combined vocabulary for adaptive fact and physical-event feedback", () => {
    const ranker = new AgentContinuityRecordRanker();
    const learning = observation("fact", "用户喜欢无糖咖啡。");
    const event = {
      ...observation("event", "项目已完成部署。"),
      kind: "conversation.user_message" as const,
    };
    const session = ranker.openSession({ observations: [learning], eventObservations: [event] });

    expect(session.lexicalVocabulary("learning").documentCount).toBe(1);
    expect(session.lexicalVocabulary("event").documentCount).toBe(1);
    expect(session.lexicalVocabulary("combined").documentCount).toBe(2);
    expect(session.lexicalVocabulary("combined").isInformative("部署")).toBe(true);
  });

  test("keeps scoresForQueries positional when every query is empty", () => {
    const index = new AgentContinuityRecallIndex(new AgentContinuityTextSimilarity());
    const entries = [observation("one", "用户喜欢无糖咖啡。")];

    expect(index.openSession(entries).scoresForQueries(["", "  ", "\t"])).toHaveLength(3);
    expect(index.openSession(entries).scoresForQueries(["", "  ", "\t"])).toEqual([new Map(), new Map(), new Map()]);
  });

  test("defers preparation until a session has a usable query", () => {
    const index = new AgentContinuityRecallIndex(new AgentContinuityTextSimilarity());
    const entries = [observation("one", "用户喜欢无糖咖啡。")];
    const prepare = vi.spyOn(index, "prepare");
    const session = index.openSession(entries);

    expect(prepare).not.toHaveBeenCalled();
    expect(session.scoresForQueries(["", "  ", "\t"])).toEqual([new Map(), new Map(), new Map()]);
    expect(prepare).not.toHaveBeenCalled();

    expect(session.scores("无糖咖啡")).toHaveProperty("size", 1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(session.vocabulary.isInformative("无糖咖啡")).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(1);
    prepare.mockRestore();
  });

  test("refreshes a query cache hit before bounded LRU eviction", () => {
    const index = new AgentContinuityRecallIndex(new AgentContinuityTextSimilarity());
    const entries = [observation("one", "用户喜欢无糖咖啡。")];
    const session = index.openSession(entries, {
      cacheTtlMs: 10_000,
      catalogRevision: "revision-1",
      catalogKey: "scope-1",
      nowMs: 1,
    });
    const capacity = AgentContinuityRecallIndexDefaults.queryCacheEntries;
    const first = session.scores("q0");
    const second = session.scores("q1");
    for (let index = 2; index < capacity; index += 1) session.scores(`q${index}`);

    expect(session.scores("q0")).toBe(first);
    session.scores(`q${capacity}`);

    expect(session.scores("q0")).toBe(first);
    expect(session.scores("q1")).not.toBe(second);
  });

  test("does not evict a warmed snapshot when a non-caching session is opened", () => {
    const index = new AgentContinuityRecallIndex(new AgentContinuityTextSimilarity());
    const entries = [observation("one", "用户喜欢无糖咖啡。")];
    const options = { catalogRevision: "1", catalogKey: "workspace", cacheTtlMs: 10_000, nowMs: 100 };
    const warmed = index.openSession(entries, options);
    expect(warmed.scores("无糖咖啡")).toHaveProperty("size", 1);

    index.openSession(entries, { ...options, cacheTtlMs: 0, nowMs: 101 });
    expect(index.openSession(entries, { ...options, nowMs: 102 })).toBeDefined();
  });

  test("does not reuse an index across scope identities with the same database revision", () => {
    const index = new AgentContinuityRecallIndex(new AgentContinuityTextSimilarity());
    const first = [observation("one", "用户喜欢无糖咖啡。")];
    const second = [observation("two", "用户住在上海。")];

    expect(index.scores("无糖咖啡", first, { catalogRevision: "same", catalogKey: "session-a" })).toHaveProperty(
      "size",
      1,
    );
    expect(index.scores("上海", second, { catalogRevision: "same", catalogKey: "session-b" })).toEqual(
      new Map([[second[0]!.uri, 1]]),
    );
  });

  test("invalidates only the requested scope snapshot", () => {
    const index = new AgentContinuityRecallIndex(new AgentContinuityTextSimilarity());
    const first = [observation("one", "用户喜欢无糖咖啡。")];
    const second = [observation("two", "用户住在上海。")];

    index.scores("无糖咖啡", first, { catalogRevision: "1", catalogKey: "session-a" });
    index.scores("上海", second, { catalogRevision: "1", catalogKey: "session-b" });
    index.clear("session-a");

    expect(index.scores("无糖咖啡", first, { catalogRevision: "1", catalogKey: "session-a" })).toEqual(
      new Map([[first[0]!.uri, 1]]),
    );
    expect(index.scores("上海", second, { catalogRevision: "1", catalogKey: "session-b" })).toEqual(
      new Map([[second[0]!.uri, 1]]),
    );
  });

  test("keeps prefetched catalogs independent for each scope set", () => {
    const revisions = new Map<string, string>();
    const reads = new Map<string, number>();
    const store = {
      recallCatalogRevision(scopes: readonly { kind: string; id: string }[]): string {
        const key = scopes
          .map((scope) => `${scope.kind}:${scope.id}`)
          .sort()
          .join(",");
        return revisions.get(key) ?? "1";
      },
      listLearningObservations(scopes: readonly { kind: string; id: string }[]): AgentContinuityObservation[] {
        const key = scopes
          .map((scope) => `${scope.kind}:${scope.id}`)
          .sort()
          .join(",");
        reads.set(key, (reads.get(key) ?? 0) + 1);
        return [observation(key, key)];
      },
      listEventObservations(): AgentContinuityObservation[] {
        return [];
      },
    } as unknown as ConstructorParameters<typeof AgentContinuityRecallCatalog>[0];
    const catalog = new AgentContinuityRecallCatalog(store);
    const scopesA = [{ kind: "user" as const, id: "a" }];
    const scopesB = [{ kind: "user" as const, id: "b" }];

    const firstA = catalog.read(scopesA, { nowMs: 1, cacheTtlMs: 100 });
    const firstB = catalog.read(scopesB, { nowMs: 2, cacheTtlMs: 100 });
    const secondA = catalog.read(scopesA, { nowMs: 3, cacheTtlMs: 100 });

    expect(secondA).toBe(firstA);
    expect(secondA).not.toBe(firstB);
    expect(reads.get("user:a")).toBe(1);
    expect(reads.get("user:b")).toBe(1);
  });

  test("does not evict a warmed catalog for a non-caching read", () => {
    let learningReads = 0;
    const store = {
      recallCatalogRevision: () => "1",
      listLearningObservations: () => {
        learningReads += 1;
        return [];
      },
      listEventObservations: () => [],
    } as unknown as ConstructorParameters<typeof AgentContinuityRecallCatalog>[0];
    const catalog = new AgentContinuityRecallCatalog(store);
    const scopes = [{ kind: "user" as const, id: "catalog-cache" }];
    const options = { nowMs: 1, cacheTtlMs: 10_000 };

    catalog.read(scopes, options);
    catalog.read(scopes, { ...options, cacheTtlMs: 0, nowMs: 2 });
    catalog.read(scopes, { ...options, nowMs: 3 });

    // The non-caching read itself is intentionally rebuilt. The final
    // positive-TTL read must still reuse the original warmed snapshot.
    expect(learningReads).toBe(2);
  });

  test("bounds catalog snapshots with an LRU", () => {
    const reads = new Map<string, number>();
    const store = {
      recallCatalogRevision: (scopes: readonly { readonly id: string }[]) => scopes[0]?.id ?? "",
      listLearningObservations: (scopes: readonly { readonly id: string }[]) => {
        const id = scopes[0]?.id ?? "";
        reads.set(id, (reads.get(id) ?? 0) + 1);
        return [];
      },
      listEventObservations: () => [],
    } as unknown as ConstructorParameters<typeof AgentContinuityRecallCatalog>[0];
    const catalog = new AgentContinuityRecallCatalog(store);
    const capacity = AgentContinuityRecallIndexDefaults.snapshotEntries;
    const read = (id: string) => catalog.read([{ kind: "user" as const, id }], { nowMs: 1, cacheTtlMs: 10_000 });

    for (let entry = 0; entry < capacity; entry += 1) read(`catalog-${entry}`);
    read("catalog-0");
    read(`catalog-${capacity}`);
    read("catalog-1");

    expect(reads.get("catalog-0")).toBe(1);
    expect(reads.get("catalog-1")).toBe(2);
  });

  test("keeps physical automatic catalogs isolated when scope keys are shared", () => {
    const episodes = [physicalEpisode("session-a", "episode-a"), physicalEpisode("session-b", "episode-b")];
    const sources = episodes.map((episode) => physicalSource(episode));
    const store = {
      recallCatalogRevision: () => "same-revision",
      listLearningObservations: () => [],
      listEventObservations: () => [],
    } as unknown as ConstructorParameters<typeof AgentContinuityRecallCatalog>[0];
    const repository = {
      catalogRevision: () => "same-revision",
      listCompletedEpisodes: () => episodes,
      listSourcesForEpisodes: (uris: readonly string[]) => sources.filter((source) => uris.includes(source.episodeUri)),
    } as unknown as AgentMemorySourceRepository;
    const catalog = new AgentContinuityRecallCatalog(store, repository);
    const scopes = [{ kind: "workspace" as const, id: "workspace" }];

    const sessionA = catalog.read(scopes, {
      nowMs: 1,
      cacheTtlMs: 100,
      identity: testContinuityIdentity("workspace"),
      sessionId: "session-a",
    });
    const sessionB = catalog.read(scopes, {
      nowMs: 2,
      cacheTtlMs: 100,
      identity: testContinuityIdentity("workspace"),
      sessionId: "session-b",
    });

    expect(sessionA.cacheKey).not.toBe(sessionB.cacheKey);
    expect(sessionA.eventObservations.map((entry) => entry.payload.sessionId)).toEqual(["session-b"]);
    expect(sessionB.eventObservations.map((entry) => entry.payload.sessionId)).toEqual(["session-a"]);
  });

  test("searches host-owned fact identities and scalar metadata", () => {
    const index = new AgentContinuityRecallIndex(new AgentContinuityTextSimilarity());
    const entry = {
      ...observation("residence", "用户住在上海。"),
      payload: { kind: "fact", fact: "用户住在上海。", factKey: "profile.residence", until: "permanent" },
    };

    expect(index.scores("profile.residence", [entry])).toEqual(new Map([[entry.uri, 1]]));
    expect(index.scores("permanent", [entry])).toHaveProperty("size", 1);
  });

  test("does not reuse a physical event's session projection across sessions", () => {
    const episodes = [physicalEpisode("session-a", "episode-a"), physicalEpisode("session-b", "episode-b")];
    const sources = episodes.map((episode) => physicalSource(episode));
    const repository = {
      catalogRevision: () => "1",
      listCompletedEpisodes: () => episodes,
      listSourcesForEpisodes: (uris: readonly string[]) => sources.filter((source) => uris.includes(source.episodeUri)),
    } as unknown as AgentMemorySourceRepository;
    const recall = new AgentContinuityEpisodeRecall(repository);

    const sessionA = recall.read({ identity: testContinuityIdentity("workspace"), sessionId: "session-a" });
    const sessionB = recall.read({ identity: testContinuityIdentity("workspace"), sessionId: "session-b" });

    expect(sessionA).not.toBe(sessionB);
    expect(sessionA.observations.find((entry) => entry.payload.sessionId === "session-a")?.scope).toEqual({
      kind: "session",
      id: "session-a",
    });
    expect(sessionB.observations.find((entry) => entry.payload.sessionId === "session-a")?.scope).toEqual({
      kind: "workspace",
      id: "workspace",
    });
    expect(sessionB.observations.find((entry) => entry.payload.sessionId === "session-b")?.scope).toEqual({
      kind: "session",
      id: "session-b",
    });

    const automaticA = recall.read({
      identity: testContinuityIdentity("workspace"),
      sessionId: "session-a",
      mode: "automatic",
    });
    expect(automaticA.observations.some((entry) => entry.payload.sessionId === "session-a")).toBe(false);
    expect(automaticA.observations.find((entry) => entry.payload.sessionId === "session-b")?.scope).toEqual({
      kind: "workspace",
      id: "workspace",
    });
  });

  test("invalidates a cached physical projection when a source changes", () => {
    const episodes = [physicalEpisode("session-a", "episode-a")];
    const sources = episodes.map((episode) => physicalSource(episode));
    let revision = "1";
    const repository = {
      catalogRevision: () => revision,
      listCompletedEpisodes: () => episodes,
      listSourcesForEpisodes: (uris: readonly string[]) => sources.filter((source) => uris.includes(source.episodeUri)),
    } as unknown as AgentMemorySourceRepository;
    const recall = new AgentContinuityEpisodeRecall(repository);

    const initial = recall.read({ identity: testContinuityIdentity("workspace"), sessionId: "session-b" });
    sources[0] = { ...sources[0]!, summary: "事件内容已修订。" };
    revision = "2";

    const refreshed = recall.read({ identity: testContinuityIdentity("workspace"), sessionId: "session-b" });

    expect(refreshed).not.toBe(initial);
    expect(refreshed.observations[0]?.summary).toBe("事件内容已修订。");
  });
});

function observation(id: string, summary: string): AgentContinuityObservation {
  return {
    id,
    uri: `senera://continuity-learning/${id}`,
    kind: "learning.record",
    summary,
    payload: { kind: "fact", fact: summary, until: "permanent" },
    sourceRefs: [`senera://memory-source/${id}`],
    watermark: `wm-${id}`,
    scope: { kind: "user", id: "workspace" },
    authority: "user_explicit",
    confidence: 1,
    occurredAt: "2026-08-23T01:00:00.000Z",
    observedAt: "2026-08-23T01:00:00.000Z",
    createdAtMs: Date.parse("2026-08-23T01:00:00.000Z"),
  };
}

function physicalEpisode(sessionId: string, id: string): AgentMemoryEpisodeRecord {
  return {
    id,
    uri: `senera://memory-episode/${id}`,
    sessionId,
    requestId: `request-${id}`,
    status: "completed",
    rawUserText: `事件 ${id}`,
    standaloneRequest: `事件 ${id}`,
    contextMode: "session",
    contextBasis: "current",
    topic: "test",
    assistantPreview: `事件 ${id}`,
    startedAt: "2026-08-23T01:00:00.000Z",
    completedAt: "2026-08-23T01:00:01.000Z",
    updatedAt: "2026-08-23T01:00:01.000Z",
    startedAtMs: 1_000,
    completedAtMs: 1_001,
    updatedAtMs: 1_001,
    timeZone: "Asia/Shanghai",
    localDate: "2026-08-23",
    localHour: "09",
    metadata: {},
  };
}

function physicalSource(episode: AgentMemoryEpisodeRecord): AgentMemorySourceRecord {
  return {
    id: `${episode.id}:user`,
    uri: `senera://memory-source/${episode.id}`,
    episodeId: episode.id,
    episodeUri: episode.uri,
    sessionId: episode.sessionId,
    requestId: episode.requestId,
    sourceKind: "user_message",
    role: "user",
    textContent: episode.rawUserText,
    summary: episode.rawUserText,
    conversationEntryId: `${episode.id}:entry`,
    evidenceUri: "",
    artifactUri: "",
    toolName: "",
    createdAt: episode.startedAt,
    updatedAt: episode.updatedAt,
    createdAtMs: episode.startedAtMs,
    updatedAtMs: episode.updatedAtMs,
    timeZone: episode.timeZone,
    localDate: episode.localDate,
    localHour: episode.localHour,
    metadata: {},
  };
}
