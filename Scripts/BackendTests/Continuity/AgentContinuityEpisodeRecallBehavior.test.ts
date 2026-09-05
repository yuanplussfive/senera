import { describe, expect, test } from "vitest";
import type {
  AgentMemoryEpisodeRecord,
  AgentMemorySourceRecord,
  AgentMemorySourceRepository,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { testContinuityIdentity } from "./AgentContinuityTestFixtures.js";
import { AgentContinuityEpisodeRecall } from "../../../Source/AgentSystem/Continuity/AgentContinuityEpisodeRecall.js";
import { isAgentContinuityEventRecallable } from "../../../Source/AgentSystem/Continuity/AgentContinuityEventRecallPolicy.js";
import { AgentContinuityRecordRanker } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecordRanker.js";
import { AgentContinuityRecallIndexDefaults } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallIndex.js";

describe("continuity physical episode recall", () => {
  test("indexes stored source text while keeping the prompt projection source-backed", () => {
    const workspaceRoot = "E:/workspace";
    const episode = episodeRecord();
    const source = sourceRecord();
    const repository = {
      catalogRevision: () => "1",
      listCompletedEpisodes: () => [episode],
      listSourcesForEpisodes: () => [source],
    } as unknown as AgentMemorySourceRepository;

    const observation = new AgentContinuityEpisodeRecall(repository).read({
      identity: testContinuityIdentity(workspaceRoot),
      mode: "automatic",
    }).observations[0];
    expect(observation).toBeDefined();
    expect(observation?.summary).toBe("天气讨论");
    expect(observation?.searchText).toBe("用户说下周六运动后提醒天气。运动完成后再提醒。");
    expect(observation?.payload).not.toHaveProperty("content");

    const ranked = new AgentContinuityRecordRanker().rankEvents({
      query: "运动完成后提醒天气",
      observations: [observation!],
      now: new Date("2026-08-25T00:00:00.000Z"),
    }).records;
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.projection).toBe("reference");
  });

  test("does not turn source metadata into recall text when an evidence body is absent", () => {
    const episode = episodeRecord();
    const emptyEvidence = {
      ...sourceRecord(),
      id: "empty-evidence",
      uri: "senera://memory-source/empty-evidence",
      sourceKind: "tool_evidence" as const,
      role: "tool",
      textContent: null,
      summary: null,
      toolName: "ComputerUse",
    };
    const repository = {
      catalogRevision: () => "1",
      listCompletedEpisodes: () => [episode],
      listSourcesForEpisodes: () => [emptyEvidence],
    } as unknown as AgentMemorySourceRepository;

    const observations = new AgentContinuityEpisodeRecall(repository).read({
      identity: testContinuityIdentity("E:/workspace"),
      mode: "automatic",
    }).observations;

    expect(observations).toEqual([]);
  });

  test("reuses a physical projection without rescanning sources until the catalog revision changes", () => {
    const episode = episodeRecord();
    const source = sourceRecord();
    let revision = "1";
    let episodeReads = 0;
    let sourceReads = 0;
    const repository = {
      catalogRevision: () => revision,
      listCompletedEpisodes: () => {
        episodeReads += 1;
        return [episode];
      },
      listSourcesForEpisodes: () => {
        sourceReads += 1;
        return [source];
      },
    } as unknown as AgentMemorySourceRepository;
    const recall = new AgentContinuityEpisodeRecall(repository);

    const first = recall.read({ identity: testContinuityIdentity("E:/workspace"), mode: "automatic" });
    const cached = recall.read({ identity: testContinuityIdentity("E:/workspace"), mode: "automatic" });
    revision = "2";
    const refreshed = recall.read({ identity: testContinuityIdentity("E:/workspace"), mode: "automatic" });

    expect(cached).toBe(first);
    expect(refreshed).not.toBe(first);
    expect(episodeReads).toBe(2);
    expect(sourceReads).toBe(2);
  });

  test("bounds physical projection snapshots with an LRU", () => {
    let episodeReads = 0;
    const repository = {
      catalogRevision: () => "1",
      listCompletedEpisodes: () => {
        episodeReads += 1;
        return [];
      },
      listSourcesForEpisodes: () => [],
    } as unknown as AgentMemorySourceRepository;
    const recall = new AgentContinuityEpisodeRecall(repository);
    const read = (workspaceId: string) =>
      recall.read({ identity: testContinuityIdentity(workspaceId), mode: "automatic" });
    const capacity = AgentContinuityRecallIndexDefaults.snapshotEntries;

    for (let index = 0; index < capacity; index += 1) read(`workspace-${index}`);
    read("workspace-0");
    read(`workspace-${capacity}`);
    read("workspace-1");

    expect(episodeReads).toBe(capacity + 2);
  });

  test("admits historical conversation and tool evidence as source-backed events", () => {
    const episode = episodeRecord();
    const user = sourceRecord();
    const assistant = {
      ...sourceRecord(),
      id: "assistant-source",
      uri: "senera://memory-source/assistant-source",
      sourceKind: "assistant_final" as const,
      role: "assistant",
      textContent: "我会记住这次天气讨论。",
      summary: "天气讨论回复",
    };
    const tool = {
      ...sourceRecord(),
      id: "tool-source",
      uri: "senera://memory-source/tool-source",
      sourceKind: "tool_evidence" as const,
      role: "tool",
      textContent: "天气工具返回下周六可能下雨。",
      summary: "天气工具返回结果",
      toolName: "WeatherRead",
      evidenceUri: "senera://evidence/tool-source",
    };
    const repository = {
      catalogRevision: () => "1",
      listCompletedEpisodes: () => [episode],
      listSourcesForEpisodes: () => [user, assistant, tool],
    } as unknown as AgentMemorySourceRepository;

    const observations = new AgentContinuityEpisodeRecall(repository).read({
      identity: testContinuityIdentity("E:/workspace"),
      mode: "automatic",
    }).observations;

    expect(observations.filter(isAgentContinuityEventRecallable).map((entry) => entry.kind)).toEqual([
      "conversation.user_message",
      "conversation.assistant_final",
      "tool.result",
    ]);
    expect(observations.filter(isAgentContinuityEventRecallable).map((entry) => entry.sourceRefs)).toEqual([
      [user.uri],
      [assistant.uri],
      [tool.uri],
    ]);
  });
});

function episodeRecord(): AgentMemoryEpisodeRecord {
  return {
    id: "episode-1",
    uri: "senera://memory-episode/episode-1",
    sessionId: "session-1",
    requestId: "request-1",
    status: "completed",
    rawUserText: "用户说下周六运动后提醒天气。",
    standaloneRequest: "用户说下周六运动后提醒天气。",
    contextMode: "",
    contextBasis: "",
    topic: "天气",
    assistantPreview: "天气讨论",
    startedAt: "2026-08-24T00:00:00+08:00",
    completedAt: "2026-08-24T00:01:00+08:00",
    updatedAt: "2026-08-24T00:01:00+08:00",
    startedAtMs: Date.parse("2026-08-24T00:00:00+08:00"),
    completedAtMs: Date.parse("2026-08-24T00:01:00+08:00"),
    updatedAtMs: Date.parse("2026-08-24T00:01:00+08:00"),
    timeZone: "Asia/Shanghai",
    localDate: "2026-08-24",
    localHour: "08",
    metadata: {},
  };
}

function sourceRecord(): AgentMemorySourceRecord {
  return {
    id: "source-1",
    uri: "senera://memory-source/source-1",
    episodeId: "episode-1",
    episodeUri: "senera://memory-episode/episode-1",
    sessionId: "session-1",
    requestId: "request-1",
    sourceKind: "user_message",
    role: "user",
    textContent: "用户说下周六运动后提醒天气。运动完成后再提醒。",
    summary: "天气讨论",
    conversationEntryId: "entry-1",
    evidenceUri: "",
    artifactUri: "",
    toolName: "",
    createdAt: "2026-08-24T00:00:00+08:00",
    updatedAt: "2026-08-24T00:00:00+08:00",
    createdAtMs: Date.parse("2026-08-24T00:00:00+08:00"),
    updatedAtMs: Date.parse("2026-08-24T00:00:00+08:00"),
    timeZone: "Asia/Shanghai",
    localDate: "2026-08-24",
    localHour: "08",
    metadata: {},
  };
}
