import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "../../../Source/AgentSystem/Conversation/AgentConversation.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { recallAgentMemories } from "../../../Source/AgentSystem/Memory/AgentMemoryRecallRuntime.js";
import {
  InMemoryAgentMemorySourceRepository,
  SqliteAgentMemorySourceRepository,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import type {
  AgentMemoryCompletedTurnInput,
  AgentMemoryConsolidationActionRecord,
  AgentMemorySourceRepository,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import {
  episodeToRow,
  memoryItemToRow,
  memoryItemVectorToRow,
  memoryObservationToRow,
} from "../../../Source/AgentSystem/Memory/AgentMemoryRowMapper.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { prepareAgentMemorySqlStatements } from "../../../Source/AgentSystem/Memory/AgentMemorySqlStatements.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    removeDirectory(temporaryDirectories.pop()!);
  }
});

describe("Memory persistence behavior", () => {
  test("recovers interrupted learning jobs after reopening SQLite", () => {
    const databasePath = createDatabasePath();
    const first = new SqliteAgentMemorySourceRepository(databasePath);
    const turn = first.recordCompletedTurn(
      completedTurn("session-learning-job", "request-learning-job", "2026-01-01T00:00:00.000Z"),
    );
    first.enqueueMemoryLearningJob(turn.episode.uri, 1_000);
    expect(first.markMemoryLearningJobRunning(turn.episode.uri, 1_001)).toEqual(
      expect.objectContaining({ status: "running", attempts: 1 }),
    );
    first.close();

    const reopened = new SqliteAgentMemorySourceRepository(databasePath);
    reopened.resetRunningMemoryLearningJobs(2_000);
    expect(reopened.listDueMemoryLearningJobs(2_000, 10)).toEqual([
      expect.objectContaining({
        episodeUri: turn.episode.uri,
        status: "retry",
        attempts: 1,
        lastError: "interrupted by runtime restart",
      }),
    ]);
    reopened.close();
  });

  test("persists completed turns, sources, candidates, and promoted memory across repository instances", async () => {
    const databasePath = createDatabasePath();
    const firstRepository = new SqliteAgentMemorySourceRepository(databasePath);
    const recorded = firstRepository.recordCompletedTurn(
      completedTurn("session-1", "request-1", "2026-01-01T00:00:00.000Z"),
    );
    const [candidate] = firstRepository.recordMemoryCandidates({
      episode: recorded.episode,
      learnedAt: "2026-01-01T00:01:00.000Z",
      candidates: [candidateDraft(recorded.sources[0]!.uri)],
    });
    const [memory] = firstRepository.applyMemoryLearning({
      episode: recorded.episode,
      learnedAt: "2026-01-01T00:02:00.000Z",
      actions: [learningAction({ candidateUris: [candidate!.uri] })],
    });
    firstRepository.close();

    const reopened = new SqliteAgentMemorySourceRepository(databasePath);
    try {
      expect(reopened.listEpisodes("session-1")).toHaveLength(1);
      expect(reopened.listSources(recorded.episode.uri).map((source) => source.sourceKind)).toEqual(
        expect.arrayContaining(["user_message", "assistant_final"]),
      );
      expect(reopened.listPendingMemoryCandidates("session-1")).toEqual([]);
      expect(reopened.listActiveMemoryItems()).toEqual([
        expect.objectContaining({ uri: memory!.uri, claim: "Prefer stable release promotion" }),
      ]);
      expect(reopened.listMemoryObservations(memory!.uri)).toEqual([
        expect.objectContaining({ operation: "create", candidateUris: [candidate!.uri] }),
      ]);

      const recalled = await recallAgentMemories(
        {
          query: "stable release",
          limit: 3,
        },
        {
          repository: reopened,
          config: memoryTestConfig,
        },
      );
      expect(recalled.memories.item).toEqual([
        expect.objectContaining({ memoryUri: memory!.uri, claim: "Prefer stable release promotion" }),
      ]);
      expect(recalled.fallback.used).toBe(false);
    } finally {
      reopened.close();
    }
  });

  test("reinforces, supersedes, and preserves vectors without leaving stale active items", () => {
    const repository = new SqliteAgentMemorySourceRepository(createDatabasePath());
    try {
      const initial = repository.writeDirectMemory(
        directWrite("create", {
          claim: "Use preview releases first",
          confidence: 0.55,
          tags: ["release"],
        }),
      );
      const reinforced = repository.writeDirectMemory(
        directWrite("reinforce", {
          targetMemoryUri: initial.uri,
          confidence: 0.9,
          tags: ["release", "preview"],
          triggers: ["deploy"],
        }),
      );
      const updated = repository.writeDirectMemory(
        directWrite("update", {
          targetMemoryUri: initial.uri,
          claim: "Use verified preview releases first",
        }),
      );
      const replacement = repository.writeDirectMemory(
        directWrite("supersede", {
          targetMemoryUri: updated.uri,
          claim: "Promote verified previews without rebuilding",
          confidence: 0.95,
        }),
      );
      repository.upsertMemoryItemVectors([
        {
          memoryUri: replacement.uri,
          model: "test-embedding",
          embedding: [0.1, 0.9],
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ]);

      expect(reinforced.uri).toBe(initial.uri);
      expect(reinforced.confidence).toBe(0.9);
      expect(reinforced.tags).toEqual(["release", "preview"]);
      expect(repository.listActiveMemoryItems()).toEqual([
        expect.objectContaining({ uri: replacement.uri, claim: "Promote verified previews without rebuilding" }),
      ]);
      expect(
        repository.listMemoryObservations(initial.uri).map((entry) => [entry.writeSequence, entry.operation]),
      ).toEqual([
        [1, "create"],
        [2, "reinforce"],
        [3, "update"],
      ]);
      expect(repository.listMemoryItemVectors("test-embedding")).toEqual([
        expect.objectContaining({ memoryUri: replacement.uri, embedding: [0.1, 0.9] }),
      ]);
    } finally {
      repository.close();
    }
  });

  test("deletes a request and every later turn in the same session", () => {
    const repository = new SqliteAgentMemorySourceRepository(createDatabasePath());
    try {
      repository.recordCompletedTurn(completedTurn("session-1", "request-1", "2026-01-01T00:00:00.000Z"));
      repository.recordCompletedTurn(completedTurn("session-1", "request-2", "2026-01-02T00:00:00.000Z"));
      repository.recordCompletedTurn(completedTurn("session-1", "request-3", "2026-01-03T00:00:00.000Z"));

      repository.deleteFromSessionRequest("session-1", "request-2");

      expect(repository.listEpisodes("session-1").map((episode) => episode.requestId)).toEqual(["request-1"]);
    } finally {
      repository.close();
    }
  });

  test("migrates the v3 item family without losing item, vector, or observation data", () => {
    const databasePath = createDatabasePath();
    const seedRepository = new InMemoryAgentMemorySourceRepository();
    const seed = seedLongTermMemory(
      seedRepository,
      "session-v3-migration",
      "request-v3-migration",
      "2026-01-01T00:00:00.000Z",
    );
    const version3Kernel = new AgentSqliteDatabaseKernel({
      databasePath,
      contract: {
        ...AgentMemoryDatabaseContract,
        migrations: AgentMemoryDatabaseContract.migrations.slice(0, 3),
      },
    });
    try {
      const statements = prepareAgentMemorySqlStatements(version3Kernel.connection);
      statements.upsertEpisodeStmt.run(episodeToRow(seed.episode));
      statements.insertMemoryItemStmt.run(memoryItemToRow(seed.memory));
      statements.insertMemoryObservationStmt.run(memoryObservationToRow(seed.observation));
      statements.upsertMemoryItemVectorStmt.run(memoryItemVectorToRow(seed.vector));
    } finally {
      version3Kernel.close();
    }

    const migrated = new SqliteAgentMemorySourceRepository(databasePath);
    try {
      expect(migrated.findMemoryItemsByUris([seed.memory.uri])).toEqual([
        expect.objectContaining({ uri: seed.memory.uri }),
      ]);
      expect(migrated.listMemoryItemVectors(seed.vector.model)).toEqual([
        expect.objectContaining({ memoryUri: seed.memory.uri, embedding: seed.vector.embedding }),
      ]);
      expect(migrated.listMemoryObservations(seed.memory.uri)).toEqual([
        expect.objectContaining({ uri: seed.observation.uri, writeSequence: 1 }),
      ]);
    } finally {
      migrated.close();
    }
  });
});

describe.each([
  {
    implementation: "SQLite",
    create: (): AgentMemorySourceRepository => new SqliteAgentMemorySourceRepository(createDatabasePath()),
  },
  {
    implementation: "in-memory",
    create: (): AgentMemorySourceRepository => new InMemoryAgentMemorySourceRepository(),
  },
])("$implementation memory item lifetime", ({ create }) => {
  test("keeps promoted items and vectors when their source session is deleted", () => {
    const repository = create();
    try {
      const seed = seedLongTermMemory(
        repository,
        "session-delete-source",
        "request-delete-source",
        "2026-01-01T00:00:00.000Z",
      );
      repository.enqueueMemoryLearningJob(seed.episode.uri, 1_000);

      repository.deleteSession("session-delete-source");

      expect(repository.listEpisodes("session-delete-source")).toEqual([]);
      expect(repository.listMemoryCandidatesForEpisode(seed.episode.uri)).toEqual([]);
      expect(repository.listMemoryLearningJobs()).toEqual([]);
      expect(repository.findMemoryItemsByUris([seed.memory.uri])).toEqual([
        expect.objectContaining({ uri: seed.memory.uri }),
      ]);
      expect(repository.listMemoryItemVectors(seed.vector.model)).toEqual([
        expect.objectContaining({ memoryUri: seed.memory.uri }),
      ]);
      expect(repository.listMemoryObservations(seed.memory.uri)).toEqual([]);

      const next = repository.recordCompletedTurn(
        completedTurn("session-next-source", "request-next-source", "2026-01-02T00:00:00.000Z"),
      );
      repository.applyMemoryLearning({
        episode: next.episode,
        learnedAt: "2026-01-02T00:01:00.000Z",
        actions: [learningAction({ operation: "reinforce", targetMemoryUri: seed.memory.uri })],
      });
      expect(repository.listMemoryObservations(seed.memory.uri)).toEqual([
        expect.objectContaining({ writeSequence: 1, sourceEpisodeUri: next.episode.uri }),
      ]);
    } finally {
      repository.close();
    }
  });

  test("keeps promoted items and vectors when source history is truncated", () => {
    const repository = create();
    try {
      repository.recordCompletedTurn(
        completedTurn("session-truncate-source", "request-before", "2026-01-01T00:00:00.000Z"),
      );
      const seed = seedLongTermMemory(
        repository,
        "session-truncate-source",
        "request-truncated",
        "2026-01-02T00:00:00.000Z",
      );

      repository.deleteFromSessionRequest("session-truncate-source", "request-truncated");

      expect(repository.listEpisodes("session-truncate-source").map((episode) => episode.requestId)).toEqual([
        "request-before",
      ]);
      expect(repository.findMemoryItemsByUris([seed.memory.uri])).toHaveLength(1);
      expect(repository.listMemoryItemVectors(seed.vector.model)).toHaveLength(1);
      expect(repository.listMemoryObservations(seed.memory.uri)).toEqual([]);
    } finally {
      repository.close();
    }
  });
});

const memoryTestConfig: AgentSystemConfig = {
  ModelProviderEndpoints: [
    {
      Id: "openai",
      BaseUrl: "https://model.example/v1",
      ApiKey: "test-key",
    },
  ],
  ModelProviders: [
    {
      Id: "test-model",
      ProviderId: "openai",
      Endpoint: "ChatCompletions",
      Model: "test-model",
    },
  ],
  VectorModels: {
    Embedding: { Enabled: false },
    Rerank: { Enabled: false },
  },
};

function createDatabasePath(): string {
  const directory = createTemporaryDirectory("senera-memory");
  temporaryDirectories.push(directory);
  return path.join(directory, "Memory.sqlite");
}

function seedLongTermMemory(
  repository: AgentMemorySourceRepository,
  sessionId: string,
  requestId: string,
  startedAt: string,
) {
  const recorded = repository.recordCompletedTurn(completedTurn(sessionId, requestId, startedAt));
  const candidate = repository.recordMemoryCandidates({
    episode: recorded.episode,
    learnedAt: startedAt,
    candidates: [candidateDraft(recorded.sources[0]!.uri)],
  })[0];
  if (!candidate) throw new Error("Expected a memory candidate.");
  const memory = repository.applyMemoryLearning({
    episode: recorded.episode,
    learnedAt: startedAt,
    actions: [learningAction({ candidateUris: [candidate.uri] })],
  })[0];
  if (!memory) throw new Error("Expected a promoted memory item.");
  repository.upsertMemoryItemVectors([
    {
      memoryUri: memory.uri,
      model: "lifetime-test-embedding",
      embedding: [0.25, 0.75],
      updatedAt: startedAt,
    },
  ]);
  const observation = repository.listMemoryObservations(memory.uri)[0];
  const vector = repository.listMemoryItemVectors("lifetime-test-embedding")[0];
  if (!observation || !vector) throw new Error("Expected memory observation and vector records.");
  return { episode: recorded.episode, candidate, memory, observation, vector };
}

function completedTurn(sessionId: string, requestId: string, startedAt: string): AgentMemoryCompletedTurnInput {
  const userEntry: Extract<AgentConversationEntry, { kind: "user.message" }> = {
    id: `${requestId}:user`,
    requestId,
    timestamp: startedAt,
    kind: AgentConversationEntryKinds.UserMessage,
    content: "Please remember the release process.",
  };
  const assistantEntry: Extract<AgentConversationEntry, { kind: "assistant.decision" }> = {
    id: `${requestId}:assistant`,
    requestId,
    timestamp: startedAt,
    kind: AgentConversationEntryKinds.AssistantDecision,
    xml: "<agent_result />",
  };
  return {
    sessionId,
    requestId,
    startedAt,
    completedAt: startedAt,
    userEntry,
    assistantEntry,
    terminal: {
      kind: "FinalAnswer",
      content: "Use a preview before stable promotion.",
    },
    conversationEntries: [userEntry, assistantEntry],
    executedTools: [],
  };
}

function candidateDraft(sourceRef: string) {
  return {
    type: "preference" as const,
    subject: "release workflow",
    claim: "Prefer stable release promotion",
    howToApply: "Promote a verified preview without rebuilding.",
    tags: ["release"],
    triggers: ["publish"],
    sourceRefs: [sourceRef],
    reason: "Explicit deployment preference.",
    confidence: 0.8,
  };
}

function learningAction(
  overrides: Partial<AgentMemoryConsolidationActionRecord> = {},
): AgentMemoryConsolidationActionRecord {
  return {
    operation: "create",
    type: "preference",
    subject: "release workflow",
    claim: "Prefer stable release promotion",
    howToApply: "Promote a verified preview without rebuilding.",
    tags: ["release"],
    triggers: ["publish"],
    sourceRefs: [],
    candidateUris: [],
    reason: "Verified release policy.",
    confidence: 0.8,
    ...overrides,
  };
}

function directWrite(
  operation: "create" | "reinforce" | "update" | "supersede",
  overrides: Record<string, unknown> = {},
) {
  return {
    operation,
    type: "preference" as const,
    subject: "release workflow",
    claim: "Use preview releases first",
    howToApply: "Publish a preview and promote it after verification.",
    tags: ["release"],
    triggers: ["publish"],
    confidence: 0.8,
    requestId: "direct-write",
    writtenAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}
