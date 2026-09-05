import { describe, expect, test } from "vitest";
import type {
  AgentMemorySourceRecord,
  AgentMemorySourceRepository,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import {
  AgentContinuityStyleExampleIndex,
  selectAgentContinuityStyleExamples,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityStyleExamples.js";
import { AgentContinuityRecallRankingDefaults } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallDefaults.js";
import { AgentContinuityRecallIndexDefaults } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallIndex.js";

describe("continuity style examples", () => {
  test("selects relevant prior dialogue locally without a model call", () => {
    const repository = {
      catalogRevision: () => "revision-1",
      listEpisodes: () => [
        { uri: "episode:relevant", assistantPreview: "", completedAt: "2026-08-23T01:00:00.000Z" },
        { uri: "episode:other", assistantPreview: "", completedAt: "2026-08-23T02:00:00.000Z" },
      ],
      listSources: (episodeUri: string) => [
        source("user", episodeUri, episodeUri === "episode:relevant" ? "用简洁的中文解释缓存。" : "写一首诗。"),
        source(
          "assistant",
          episodeUri,
          episodeUri === "episode:relevant" ? "缓存命中依赖稳定前缀。" : "月光落在湖面。",
        ),
      ],
    } as unknown as AgentMemorySourceRepository;

    const result = selectAgentContinuityStyleExamples({
      sourceRepository: repository,
      sessionId: "session-1",
      query: "用简洁的中文解释缓存。",
      maxEntries: 2,
      similarity: AgentContinuityRecallRankingDefaults.Similarity,
      minimumScore: 0.1,
    });

    expect(result.available).toBe(2);
    expect(result.matched).toBeGreaterThan(0);
    expect(result.examples[0]).toMatchObject({
      userText: "用简洁的中文解释缓存。",
      assistantText: "缓存命中依赖稳定前缀。",
    });
  });

  test("bounds session projections with an LRU", () => {
    const reads = new Map<string, number>();
    const repository = {
      catalogRevision: () => "revision-1",
      listEpisodes: (sessionId: string) => {
        reads.set(sessionId, (reads.get(sessionId) ?? 0) + 1);
        return [];
      },
      listSources: () => [],
    } as unknown as AgentMemorySourceRepository;
    const index = new AgentContinuityStyleExampleIndex(repository);
    const capacity = AgentContinuityRecallIndexDefaults.snapshotEntries;
    const select = (sessionId: string) =>
      index.select({
        sessionId,
        query: "",
        maxEntries: 1,
        similarity: AgentContinuityRecallRankingDefaults.Similarity,
        minimumScore: 0,
      });

    for (let entry = 0; entry < capacity; entry += 1) select(`session-${entry}`);
    select("session-0");
    select(`session-${capacity}`);
    select("session-1");

    expect(reads.get("session-0")).toBe(1);
    expect(reads.get("session-1")).toBe(2);
  });
});

function source(kind: "user" | "assistant", episodeUri: string, text: string): AgentMemorySourceRecord {
  return {
    id: `${episodeUri}:${kind}`,
    uri: `source:${episodeUri}:${kind}`,
    episodeId: episodeUri,
    episodeUri,
    sessionId: "session-1",
    requestId: episodeUri,
    sourceKind: kind === "user" ? "user_message" : "assistant_final",
    role: kind,
    textContent: text,
    summary: text,
    conversationEntryId: `${episodeUri}:${kind}`,
    evidenceUri: "",
    artifactUri: "",
    toolName: "",
    createdAt: "2026-08-23T01:00:00.000Z",
    updatedAt: "2026-08-23T01:00:00.000Z",
    createdAtMs: 0,
    updatedAtMs: 0,
    timeZone: "UTC",
    localDate: "2026-08-23",
    localHour: "01",
    metadata: {},
  };
}
