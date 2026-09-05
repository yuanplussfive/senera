import { describe, expect, test } from "vitest";
import {
  AgentConversationEntryKinds,
  createConversationEntryId,
} from "../../../Source/AgentSystem/Conversation/AgentConversation.js";
import {
  InMemoryAgentMemorySourceRepository,
  type AgentMemoryRecordedTurn,
  type AgentMemorySourceRecord,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { buildAgentContinuityLearningReferentContext } from "../../../Source/AgentSystem/Continuity/AgentContinuityLearningReferentContext.js";

describe("continuity learning referent context", () => {
  test("projects the nearest complete physical conversation turn as reference-only context", () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    recordTurn(repository, {
      requestId: "request-older",
      startedAt: "2026-08-23T00:00:00.000Z",
      completedAt: "2026-08-23T00:00:01.000Z",
      user: "第一轮讨论的是西湖边的咖啡店。",
      assistant: "第一轮已记录店铺位置。",
    });
    const nearest = recordTurn(repository, {
      requestId: "request-nearest",
      startedAt: "2026-08-23T00:01:00.000Z",
      completedAt: "2026-08-23T00:01:01.000Z",
      user: "我说的是过桥米线里的辣椒。",
      assistant: "明白，是那碗过桥米线里的辣椒。",
    });
    const current = recordTurn(repository, {
      requestId: "request-current",
      startedAt: "2026-08-23T00:02:00.000Z",
      completedAt: "2026-08-23T00:02:01.000Z",
      user: "它不好吃。",
      assistant: "我理解你的评价。",
    });
    const nearestSources = repository.listSources(nearest.episode.uri);
    const toolSource: AgentMemorySourceRecord = {
      ...nearestSources[0]!,
      id: "tool-source",
      uri: "senera://memory-source/tool-source",
      sourceKind: "tool_evidence",
      role: "tool",
      textContent: "不应作为跨轮指代语境的工具输出。",
      summary: "不应作为跨轮指代语境的工具输出。",
    };
    const budget = nearestSources.reduce((total, source) => total + sourceText(source).length, 0);
    const entries = buildAgentContinuityLearningReferentContext({
      sourceRepository: {
        listEpisodes: (sessionId) => repository.listEpisodes(sessionId),
        listSources: (episodeUri) =>
          episodeUri === nearest.episode.uri
            ? [...repository.listSources(episodeUri), toolSource]
            : repository.listSources(episodeUri),
      },
      recordedTurn: current,
      budgetCharacters: budget,
    }).entries;

    expect(entries).toEqual([
      {
        role: "user",
        text: "我说的是过桥米线里的辣椒。",
        createdAt: "2026-08-23T00:01:00.000Z",
      },
      {
        role: "assistant",
        text: "明白，是那碗过桥米线里的辣椒。",
        createdAt: "2026-08-23T00:01:01.000Z",
      },
    ]);
    expect(entries.map((entry) => entry.text)).not.toContain("不应作为跨轮指代语境的工具输出。");
    expect(entries.map((entry) => entry.text)).not.toContain("它不好吃。");
    expect(entries.map((entry) => entry.text)).not.toContain("第一轮讨论的是西湖边的咖啡店。");
    repository.close();
  });
});

function recordTurn(
  repository: InMemoryAgentMemorySourceRepository,
  input: {
    readonly requestId: string;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly user: string;
    readonly assistant: string;
  },
): AgentMemoryRecordedTurn {
  const userEntry = {
    kind: AgentConversationEntryKinds.UserMessage,
    id: createConversationEntryId(input.requestId, "user"),
    requestId: input.requestId,
    timestamp: input.startedAt,
    content: input.user,
  } as const;
  const assistantEntry = {
    kind: AgentConversationEntryKinds.AssistantDecision,
    id: createConversationEntryId(input.requestId, "assistant"),
    requestId: input.requestId,
    timestamp: input.completedAt,
    xml: input.assistant,
  } as const;
  return repository.recordCompletedTurn({
    sessionId: "session-referents",
    requestId: input.requestId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    userEntry,
    assistantEntry,
    terminal: { kind: "FinalAnswer", content: input.assistant },
    executedTools: [],
  });
}

function sourceText(source: AgentMemorySourceRecord): string {
  const text =
    source.sourceKind === "assistant_final"
      ? (source.summary ?? source.textContent ?? "")
      : (source.textContent ?? source.summary ?? "");
  return text.trim();
}
