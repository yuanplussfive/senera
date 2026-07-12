import { describe, expect, test, vi } from "vitest";
import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "../../../Source/AgentSystem/Conversation/AgentConversation.js";
import {
  AgentMemoryLearningRuntime,
  candidateToProposedMemoryWrite,
  type AgentMemoryLearningClient,
  type AgentMemoryWriteDecisionResolver,
} from "../../../Source/AgentSystem/Memory/AgentMemoryLearningRuntime.js";
import type { AgentMemoryLearningVectorClient } from "../../../Source/AgentSystem/Memory/AgentMemoryLearningVectorRuntime.js";
import type { AgentLogger } from "../../../Source/AgentSystem/Diagnostics/AgentLogger.js";
import {
  InMemoryAgentMemorySourceRepository,
  type AgentMemoryCandidateDraft,
  type AgentMemoryCompletedTurnInput,
  type AgentMemoryRecordedTurn,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTurnUnderstanding } from "../Support/AgentTestFixtures.js";

describe("Memory learning runtime behavior", () => {
  test("does not create model dependencies when memory learning is disabled", async () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const runtime = new AgentMemoryLearningRuntime({
      repository,
      configSnapshot: () => memoryLearningConfig({ enabled: false }),
      createDependencies: vi.fn(() => {
        throw new Error("disabled memory learning must not create dependencies");
      }),
    });

    await runtime.learn(recordedTurn(repository));

    expect(repository.listPendingMemoryCandidates("session-memory")).toEqual([]);
    expect(repository.listActiveMemoryItems()).toEqual([]);
  });

  test("skips persistence when the learning model returns no durable candidates", async () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const learningClient = fakeLearningClient({
      learnAndValidate: async () => ({ candidates: [] }),
    });
    const vectorClient = fakeVectorClient();
    const writeResolver = fakeWriteResolver();
    const logger = fakeLogger();
    const runtime = new AgentMemoryLearningRuntime({
      repository,
      logger,
      configSnapshot: () => memoryLearningConfig({ enabled: true }),
      createDependencies: () => ({ learningClient, vectorClient, writeResolver }),
    });

    await runtime.learn(recordedTurn(repository));

    expect(logger.info).toHaveBeenCalledWith(
      "memory.learning.skipped",
      expect.objectContaining({
        reason: "BAML returned no durable memory candidates",
      }),
    );
    expect(vectorClient.embed).not.toHaveBeenCalled();
    expect(writeResolver.resolve).not.toHaveBeenCalled();
    expect(repository.listPendingMemoryCandidates("session-memory")).toEqual([]);
  });

  test("records candidates and absorbs rejected writes without promoting memory", async () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const learningClient = fakeLearningClient({
      learnAndValidate: async (input) => ({
        candidates: [memoryCandidateDraft("release policy", input.supportingSourceRefs)],
      }),
    });
    const vectorClient = fakeVectorClient();
    const writeResolver = fakeWriteResolver(async (input) => ({
      ...input.proposed,
      operation: "reject",
      reason: "The candidate is too transient.",
    }));
    const runtime = new AgentMemoryLearningRuntime({
      repository,
      configSnapshot: () => memoryLearningConfig({ enabled: true }),
      createDependencies: () => ({ learningClient, vectorClient, writeResolver }),
    });

    await runtime.learn(recordedTurn(repository));

    expect(vectorClient.embed).toHaveBeenCalledTimes(1);
    expect(writeResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "automatic_learning",
        proposed: expect.objectContaining({
          operation: "create",
          claim: "Remember release policy",
        }),
      }),
    );
    expect(repository.listPendingMemoryCandidates("session-memory")).toEqual([]);
    expect(repository.listActiveMemoryItems()).toEqual([]);
  });

  test("promotes ready candidate clusters into active memory and records embeddings", async () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const learningClient = fakeLearningClient({
      learnAndValidate: async (input) => ({
        candidates: [memoryCandidateDraft("release candidate promotion", input.supportingSourceRefs)],
      }),
      consolidateAndValidate: async (input) => ({
        actions: [
          {
            operation: "create",
            type: "preference",
            subject: "release workflow",
            claim: "Promote verified release candidates without rebuilding",
            howToApply: "Verify once, then promote the same artifact.",
            tags: ["release"],
            triggers: ["publish"],
            sourceRefs: input.candidates[0]?.sourceRefs ?? [],
            candidateUris: input.candidates.map((candidate) => candidate.uri),
            reason: "The cluster reached promotion support.",
            confidence: 0.91,
          },
        ],
      }),
    });
    const vectorClient = fakeVectorClient();
    const writeResolver = fakeWriteResolver(async (input) => input.proposed);
    const runtime = new AgentMemoryLearningRuntime({
      repository,
      configSnapshot: () =>
        memoryLearningConfig({
          enabled: true,
          minSupport: 1,
          minSimilarity: 0,
        }),
      createDependencies: () => ({ learningClient, vectorClient, writeResolver }),
    });

    await runtime.learn(recordedTurn(repository));

    expect(learningClient.consolidateAndValidate).toHaveBeenCalledTimes(1);
    expect(vectorClient.rerank).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: [expect.objectContaining({ id: expect.stringContaining("memory-candidate") })],
      }),
    );
    expect(repository.listPendingMemoryCandidates("session-memory")).toEqual([]);
    expect(repository.listActiveMemoryItems()).toEqual([
      expect.objectContaining({
        claim: "Promote verified release candidates without rebuilding",
        sourceRefs: expect.arrayContaining([expect.stringContaining("memory-source")]),
      }),
    ]);
    expect(repository.listMemoryItemVectors("test-vector")).toEqual([
      expect.objectContaining({
        memoryUri: repository.listActiveMemoryItems()[0]?.uri,
        embedding: [1, 0, 0],
      }),
    ]);
  });

  test("projects recorded candidates into proposed create writes", () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const turn = recordedTurn(repository);
    const [candidate] = repository.recordMemoryCandidates({
      episode: turn.episode,
      candidates: [memoryCandidateDraft("release policy", [turn.sources[0]!.uri])],
      learnedAt: "2026-01-01T00:00:02.000Z",
    });

    expect(candidateToProposedMemoryWrite(candidate!)).toEqual(
      expect.objectContaining({
        operation: "create",
        candidateUris: [candidate!.uri],
        sourceRefs: candidate!.sourceRefs,
      }),
    );
  });
});

function recordedTurn(repository: InMemoryAgentMemorySourceRepository): AgentMemoryRecordedTurn {
  return repository.recordCompletedTurn(
    completedTurn({
      requestId: "request-memory-learning",
      userText: "Remember that release candidates should be promoted without rebuilding.",
      assistantText: "I will keep that release workflow in mind.",
      startedAt: "2026-01-01T00:00:00.000Z",
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

function memoryCandidateDraft(subject: string, sourceRefs: readonly string[] = []): AgentMemoryCandidateDraft {
  return {
    type: "preference",
    subject,
    claim: `Remember ${subject}`,
    howToApply: "Use the remembered release workflow when planning publish steps.",
    tags: ["release"],
    triggers: ["publish"],
    sourceRefs: [...sourceRefs],
    reason: "The user asked Senera to remember this workflow.",
    confidence: 0.84,
  };
}

function fakeLearningClient(overrides: Partial<AgentMemoryLearningClient> = {}): AgentMemoryLearningClient & {
  learnAndValidate: ReturnType<typeof vi.fn<AgentMemoryLearningClient["learnAndValidate"]>>;
  consolidateAndValidate: ReturnType<typeof vi.fn<AgentMemoryLearningClient["consolidateAndValidate"]>>;
} {
  return {
    learnAndValidate: vi.fn(overrides.learnAndValidate ?? (async () => ({ candidates: [] }))),
    consolidateAndValidate: vi.fn(overrides.consolidateAndValidate ?? (async () => ({ actions: [] }))),
  };
}

function fakeVectorClient(): AgentMemoryLearningVectorClient & {
  embed: ReturnType<typeof vi.fn<AgentMemoryLearningVectorClient["embed"]>>;
  rerank: ReturnType<typeof vi.fn<AgentMemoryLearningVectorClient["rerank"]>>;
} {
  return {
    embed: vi.fn(async (request) => ({
      model: "test-vector",
      vectors: request.input.map(() => [1, 0, 0]),
    })),
    rerank: vi.fn(async (request) => ({
      model: "test-rerank",
      results: request.documents.map((document, index) => ({
        id: document.id,
        index,
        score: 1 - index * 0.01,
      })),
    })),
  };
}

function fakeWriteResolver(
  resolve: AgentMemoryWriteDecisionResolver["resolve"] = async (input) => input.proposed,
): AgentMemoryWriteDecisionResolver & {
  resolve: ReturnType<typeof vi.fn<AgentMemoryWriteDecisionResolver["resolve"]>>;
} {
  return {
    resolve: vi.fn(resolve),
  };
}

function fakeLogger(): AgentLogger & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
} {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  } as Partial<AgentLogger> as AgentLogger & {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
}

function memoryLearningConfig(options: {
  enabled: boolean;
  minSupport?: number;
  minSimilarity?: number;
}): AgentSystemConfig {
  return {
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
    ToolLearning: {
      Enabled: options.enabled,
    },
    MemoryLearning: {
      Promotion: {
        MinSupport: options.minSupport,
        MinSimilarity: options.minSimilarity,
      },
    },
    VectorModels: {
      Embedding: { Enabled: true, Model: "test-vector" },
      Rerank: { Enabled: true, Model: "test-rerank" },
    },
  };
}

function addSeconds(isoText: string, seconds: number): string {
  return new Date(new Date(isoText).getTime() + seconds * 1_000).toISOString();
}
