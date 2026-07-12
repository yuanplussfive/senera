import { describe, expect, test } from "vitest";
import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "../../../Source/AgentSystem/Conversation/AgentConversation.js";
import {
  InMemoryAgentMemorySourceRepository,
  type AgentMemoryCompletedTurnInput,
  type AgentMemoryRecordedTurn,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { recallAgentMemories } from "../../../Source/AgentSystem/Memory/AgentMemoryRecallRuntime.js";
import {
  buildMemoryConsolidationPromptInput,
  buildMemoryLearningPromptInput,
  candidateSourceRefs,
} from "../../../Source/AgentSystem/Memory/AgentMemoryLearningPromptProjector.js";
import type {
  AgentMemoryCandidateRecord,
  AgentMemoryItemRecord,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTurnUnderstanding } from "../Support/AgentTestFixtures.js";

describe("Memory conversation recall behavior", () => {
  test("falls back to ordinary conversation turns when no durable memory matches", async () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const releaseTurn = repository.recordCompletedTurn(
      completedTurn({
        requestId: "request-release",
        userText: "Remember that release candidates must be promoted without rebuilding.",
        assistantText: "Use the same verified release candidate artifact for stable promotion.",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    repository.recordCompletedTurn(
      completedTurn({
        requestId: "request-design",
        userText: "Prefer compact model configuration forms.",
        assistantText: "Use dense controls and keep the form scannable.",
        startedAt: "2026-01-02T00:00:00.000Z",
      }),
    );

    const result = await recallAgentMemories(
      {
        query: "release candidate promotion",
        limit: 3,
      },
      {
        repository,
        config: memoryRecallConfig,
      },
    );

    expect(result.memories.item).toEqual([]);
    expect(result.fallback).toEqual({
      used: true,
      reason: "No active long-term memory matched; searched ordinary conversation memory instead.",
    });
    expect(result.turns.item).toEqual([
      expect.objectContaining({
        episodeUri: releaseTurn.episode.uri,
        requestId: "request-release",
        matchedBy: { item: ["keyword"] },
        userMessage: expect.objectContaining({
          sourceRef: releaseTurn.sources.find((source) => source.sourceKind === "user_message")?.uri,
          text: "Remember that release candidates must be promoted without rebuilding.",
        }),
        assistantMessage: expect.objectContaining({
          sourceRef: releaseTurn.sources.find((source) => source.sourceKind === "assistant_final")?.uri,
          text: "Use the same verified release candidate artifact for stable promotion.",
        }),
      }),
    ]);
    expect(result.sources.item.map((source) => source.sourceRef)).toEqual(
      releaseTurn.sources.map((source) => source.uri),
    );
  });

  test("uses direct episode and source references as exact conversation matches", async () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const older = repository.recordCompletedTurn(
      completedTurn({
        requestId: "request-older",
        userText: "We discussed release notes yesterday.",
        assistantText: "Keep them short.",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const newer = repository.recordCompletedTurn(
      completedTurn({
        requestId: "request-newer",
        userText: "We discussed sandbox installation today.",
        assistantText: "Detect support before installing.",
        startedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    const assistantSourceRef = older.sources.find((source) => source.sourceKind === "assistant_final")!.uri;

    const result = await recallAgentMemories(
      {
        query: "unrelated query",
        refs: [newer.episode.uri, assistantSourceRef],
        limit: 5,
      },
      {
        repository,
        config: memoryRecallConfig,
      },
    );

    expect(result.turns.item.map((turn) => turn.episodeUri)).toEqual([newer.episode.uri, older.episode.uri]);
    expect(result.turns.item.map((turn) => turn.matchedBy.item)).toEqual([["exact_ref"], ["exact_ref"]]);
  });

  test("projects learning and consolidation prompts with source roles and stable candidate refs", () => {
    const recordedTurn = completedRecordedTurn();
    const prompt = buildMemoryLearningPromptInput(recordedTurn);
    const candidates = [memoryCandidate(recordedTurn, "candidate://release")];
    const existing = [memoryItem(recordedTurn, "memory://release")];
    const consolidation = buildMemoryConsolidationPromptInput(recordedTurn, candidates, existing);

    expect(prompt.supportingSourceRefs).toEqual([
      recordedTurn.sources.find((source) => source.sourceKind === "user_message")?.uri,
    ]);
    expect(prompt.contextSourceRefs).toEqual([
      recordedTurn.sources.find((source) => source.sourceKind === "assistant_final")?.uri,
    ]);
    expect(prompt.timeline.map((entry) => [entry.role, entry.kind])).toEqual([
      ["user", "memory_user_message"],
      ["assistant", "memory_assistant_context"],
    ]);
    expect(prompt.timeline[0]?.payloadJson).toContain('"sourceKind":"user_message"');
    expect(consolidation.candidates).toEqual([
      expect.objectContaining({
        uri: "candidate://release",
        sourceRefs: candidates[0]!.sourceRefs,
      }),
    ]);
    expect(consolidation.existingMemories).toEqual([
      expect.objectContaining({
        uri: "memory://release",
        claim: "Promote verified release candidates without rebuilding",
      }),
    ]);
    expect(candidateSourceRefs(candidates)).toEqual(new Map([["candidate://release", candidates[0]!.sourceRefs]]));
  });
});

const memoryRecallConfig: AgentSystemConfig = {
  ModelProviderEndpoints: [
    {
      Id: "test-endpoint",
      BaseUrl: "https://model.example/v1",
      ApiKey: "test-key",
    },
  ],
  ModelProviders: [
    {
      Id: "test-model",
      ProviderId: "test-endpoint",
      Endpoint: "ChatCompletions",
      Model: "test-model",
    },
  ],
  VectorModels: {
    Embedding: { Enabled: false },
    Rerank: { Enabled: false },
  },
};

function completedRecordedTurn(): AgentMemoryRecordedTurn {
  const repository = new InMemoryAgentMemorySourceRepository();
  return repository.recordCompletedTurn(
    completedTurn({
      requestId: "request-learning",
      userText: "Remember to promote verified release candidates without rebuilding.",
      assistantText: "I will keep the release candidate artifact stable.",
      startedAt: "2026-01-03T00:00:00.000Z",
    }),
  );
}

function completedTurn(input: {
  requestId: string;
  userText: string;
  assistantText: string;
  startedAt: string;
}): AgentMemoryCompletedTurnInput {
  const completedAt = addSeconds(input.startedAt, 1);
  const userEntry: Extract<AgentConversationEntry, { kind: "user.message" }> = {
    id: `${input.requestId}:user`,
    requestId: input.requestId,
    timestamp: input.startedAt,
    kind: AgentConversationEntryKinds.UserMessage,
    content: input.userText,
  };
  const assistantEntry: Extract<AgentConversationEntry, { kind: "assistant.decision" }> = {
    id: `${input.requestId}:assistant`,
    requestId: input.requestId,
    timestamp: completedAt,
    kind: AgentConversationEntryKinds.AssistantDecision,
    xml: `<agent_result><final_answer>${input.assistantText}</final_answer></agent_result>`,
  };
  return {
    sessionId: "session-memory",
    requestId: input.requestId,
    startedAt: input.startedAt,
    completedAt,
    userEntry,
    assistantEntry,
    terminal: {
      kind: "FinalAnswer",
      content: input.assistantText,
    },
    conversationEntries: [userEntry, assistantEntry],
    turnUnderstanding: createTurnUnderstanding(input.userText, {
      standaloneRequest: input.userText,
    }),
  };
}

function addSeconds(isoText: string, seconds: number): string {
  return new Date(new Date(isoText).getTime() + seconds * 1_000).toISOString();
}

function memoryCandidate(recordedTurn: AgentMemoryRecordedTurn, uri: string): AgentMemoryCandidateRecord {
  const now = recordedTurn.episode.completedAt;
  return {
    id: uri.replace(/\W/g, "_"),
    uri,
    status: "pending",
    sessionId: recordedTurn.episode.sessionId,
    sourceEpisodeUri: recordedTurn.episode.uri,
    sourceRequestId: recordedTurn.episode.requestId,
    type: "preference",
    subject: "release workflow",
    claim: "Promote verified release candidates without rebuilding",
    howToApply: "Verify once, then promote the same artifact.",
    tags: ["release"],
    triggers: ["publish"],
    sourceRefs: [recordedTurn.sources[0]!.uri],
    reason: "The user gave a durable release preference.",
    confidence: 0.86,
    promotedMemoryUri: "",
    createdAt: now,
    updatedAt: now,
    createdAtMs: recordedTurn.episode.completedAtMs,
    updatedAtMs: recordedTurn.episode.completedAtMs,
    timeZone: recordedTurn.episode.timeZone,
    localDate: recordedTurn.episode.localDate,
    localHour: recordedTurn.episode.localHour,
    metadata: {},
  };
}

function memoryItem(recordedTurn: AgentMemoryRecordedTurn, uri: string): AgentMemoryItemRecord {
  const now = recordedTurn.episode.completedAt;
  return {
    id: uri.replace(/\W/g, "_"),
    uri,
    type: "preference",
    subject: "release workflow",
    claim: "Promote verified release candidates without rebuilding",
    howToApply: "Verify once, then promote the same artifact.",
    tags: ["release"],
    triggers: ["publish"],
    sourceRefs: [recordedTurn.sources[0]!.uri],
    status: "active",
    confidence: 0.9,
    sessionId: recordedTurn.episode.sessionId,
    sourceEpisodeUri: recordedTurn.episode.uri,
    sourceRequestId: recordedTurn.episode.requestId,
    createdAt: now,
    updatedAt: now,
    createdAtMs: recordedTurn.episode.completedAtMs,
    updatedAtMs: recordedTurn.episode.completedAtMs,
    timeZone: recordedTurn.episode.timeZone,
    localDate: recordedTurn.episode.localDate,
    localHour: recordedTurn.episode.localHour,
    metadata: {},
  };
}
