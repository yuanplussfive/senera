import { afterEach, describe, expect, test } from "vitest";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { SqliteAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import {
  recallContinuity,
  writeContinuityHostTool,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityToolRuntime.js";
import { AgentContinuityRecallRankingDefaults } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallDefaults.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { AgentTemporalMemorySqliteStore } from "../../../Source/AgentSystem/TemporalMemory/AgentTemporalMemorySqliteStore.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { testContinuityIdentity } from "./AgentContinuityTestFixtures.js";
import {
  AgentContinuitySemanticRecall,
  type AgentContinuitySemanticEmbeddingClient,
} from "../../../Source/AgentSystem/Continuity/AgentContinuitySemanticRecall.js";
import { AgentLocalEmbeddingModelName } from "../../../Source/AgentSystem/ToolSearch/AgentLocalEmbeddingClient.js";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("continuity tool runtime", async () => {
  test("recall ranks by persisted local embedding evidence when enabled", async () => {
    const workspaceRoot = createWorkspace();
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: databasePath(workspaceRoot),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentContinuitySqliteStore(kernel);
    const sourceRepository = new SqliteAgentMemorySourceRepository(kernel);
    try {
      const uri = "senera://continuity-learning/semantic-only";
      store.recordObservation({
        id: "semantic-only",
        uri,
        kind: "learning.record",
        summary: "用户只喝无糖美式咖啡。",
        payload: { kind: "fact", until: "permanent" },
        sourceRefs: ["senera://memory-source/semantic-only"],
        watermark: "wm-semantic-only",
        scope: { kind: "workspace", id: workspaceRoot },
        authority: "user_explicit",
        confidence: 1,
        occurredAt: "2026-08-23T01:00:00.000Z",
        observedAt: "2026-08-23T01:00:01.000Z",
        createdAtMs: Date.parse("2026-08-23T01:00:01.000Z"),
      });
      const client: AgentContinuitySemanticEmbeddingClient = {
        embed: async (request) => ({
          model: AgentLocalEmbeddingModelName,
          vectors: request.input.map(() => [1, 0, 0]),
        }),
      };
      const semanticRecall = new AgentContinuitySemanticRecall({
        store,
        client,
        model: () => AgentLocalEmbeddingModelName,
        scoreFloor: () => 0,
      });
      await semanticRecall.embedObservations([{ uri, summary: "用户只喝无糖美式咖啡。" }]);

      const result = await recallContinuity(
        { query: "我想喝一杯拿铁" },
        {
          store,
          sourceRepository,
          temporalMemoryStore: new AgentTemporalMemorySqliteStore(kernel),
          timeZone: "Asia/Shanghai",
          identity: testContinuityIdentity(workspaceRoot),
          ranking: AgentContinuityRecallRankingDefaults,
          semanticRecall,
          semantic: { Enabled: true, TimeoutMs: 1000, ScoreFloor: 0, MinQueryCharacters: 0 },
        },
      );

      const hit = result.records.item.find((record) => record.recordUri === uri);
      expect(hit).toBeDefined();
      expect(hit!.matchedBy.item).toContain("embedding");
    } finally {
      kernel.close();
    }
  });

  test("stops semantic recall when its caller cancels", async () => {
    const fixture = createSemanticRecallFixture();
    try {
      let markQueryStarted: (() => void) | undefined;
      const queryStarted = new Promise<void>((resolve) => {
        markQueryStarted = resolve;
      });
      const semanticRecall = new AgentContinuitySemanticRecall({
        store: fixture.store,
        client: blockingSemanticQueryClient(() => markQueryStarted?.()),
        model: () => AgentLocalEmbeddingModelName,
        scoreFloor: () => 0,
      });
      await semanticRecall.embedObservations([fixture.observation]);

      const controller = new AbortController();
      const pending = recallContinuity(
        { query: "无糖美式咖啡" },
        semanticRecallOptions(fixture, semanticRecall, { signal: controller.signal }),
      );
      await queryStarted;
      controller.abort(new AgentCancellationError("Recall cancelled by the caller."));

      await expect(pending).rejects.toMatchObject({
        name: "AgentCancellationError",
        message: "Recall cancelled by the caller.",
      });
    } finally {
      fixture.kernel.close();
    }
  });

  test("reports a semantic timeout while retaining lexical recall", async () => {
    const fixture = createSemanticRecallFixture();
    try {
      const semanticRecall = new AgentContinuitySemanticRecall({
        store: fixture.store,
        client: blockingSemanticQueryClient(),
        model: () => AgentLocalEmbeddingModelName,
        scoreFloor: () => 0,
      });
      await semanticRecall.embedObservations([fixture.observation]);

      const result = await recallContinuity(
        { query: "无糖美式咖啡" },
        semanticRecallOptions(fixture, semanticRecall, { timeoutMs: 1 }),
      );

      expect(result.records.item).toEqual(
        expect.arrayContaining([expect.objectContaining({ recordUri: fixture.observation.uri })]),
      );
      expect(result.retrieval).toEqual({
        semantic: expect.objectContaining({ status: "timeout", indexedCount: 0, compatibleCount: 0 }),
      });
    } finally {
      fixture.kernel.close();
    }
  });

  test("reports a semantic provider failure instead of hiding lexical-only recall", async () => {
    const fixture = createSemanticRecallFixture();
    try {
      const semanticRecall = new AgentContinuitySemanticRecall({
        store: fixture.store,
        client: vectorEmbeddingClient(),
        model: () => AgentLocalEmbeddingModelName,
        scoreFloor: () => 0,
      });
      await semanticRecall.embedObservations([fixture.observation]);
      semanticRecall.setClient({
        embed: async () => {
          throw new Error("semantic provider unavailable");
        },
      });

      const result = await recallContinuity({ query: "无糖美式咖啡" }, semanticRecallOptions(fixture, semanticRecall));

      expect(result.records.item).toEqual(
        expect.arrayContaining([expect.objectContaining({ recordUri: fixture.observation.uri })]),
      );
      expect(result.retrieval).toEqual({
        semantic: expect.objectContaining({ status: "request_failed", indexedCount: 1, compatibleCount: 0 }),
      });
    } finally {
      fixture.kernel.close();
    }
  });

  test("turns explicit writes into tool evidence instead of a parallel database record", async () => {
    const workspaceRoot = createWorkspace();
    const result = await writeContinuityHostTool(
      { summary: "Use concise Chinese with the conclusion first.", until: "permanent" },
      toolContext(workspaceRoot),
    );

    expect(result.response).toMatchObject({
      ok: true,
      result: {
        status: "accepted_for_learning",
        records: {
          item: [
            {
              kind: "fact",
              summary: "Use concise Chinese with the conclusion first.",
              until: "permanent",
            },
          ],
        },
      },
    });
  });

  test("recalls learning records and exposes their physical source references", async () => {
    const workspaceRoot = createWorkspace();
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: databasePath(workspaceRoot),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentContinuitySqliteStore(kernel);
    const sourceRepository = new SqliteAgentMemorySourceRepository(kernel);
    try {
      store.recordObservation({
        id: "preference",
        uri: "senera://continuity-learning/preference",
        kind: "learning.record",
        summary: "The user prefers concise Chinese responses.",
        payload: {
          kind: "fact",
          summary: "The user prefers concise Chinese responses.",
          until: "permanent",
        },
        sourceRefs: ["senera://memory-source/preference"],
        watermark: "wm-preference",
        scope: { kind: "workspace", id: workspaceRoot },
        authority: "user_explicit",
        confidence: 1,
        occurredAt: "2026-08-23T01:00:00.000Z",
        observedAt: "2026-08-23T01:00:01.000Z",
        createdAtMs: Date.parse("2026-08-23T01:00:01.000Z"),
      });

      const result = await recallContinuity(
        { query: "The user prefers concise Chinese responses." },
        {
          store,
          sourceRepository,
          temporalMemoryStore: new AgentTemporalMemorySqliteStore(kernel),
          timeZone: "Asia/Shanghai",
          identity: testContinuityIdentity(workspaceRoot),
          ranking: AgentContinuityRecallRankingDefaults,
        },
      );

      expect(result.records.item).toEqual([
        expect.objectContaining({
          recordUri: "senera://continuity-learning/preference",
          sourceRefs: { item: ["senera://memory-source/preference"] },
        }),
      ]);
      expect(result).not.toHaveProperty("turns");
      expect(result).not.toHaveProperty("fallback");
    } finally {
      kernel.close();
    }
  });

  test("recalls a completed physical episode before its learning record exists", async () => {
    const workspaceRoot = createWorkspace();
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: databasePath(workspaceRoot),
      contract: AgentMemoryDatabaseContract,
    });
    const sourceRepository = new SqliteAgentMemorySourceRepository(kernel);
    try {
      sourceRepository.recordCompletedTurn({
        sessionId: "session-1",
        requestId: "request-1",
        startedAt: "2026-08-23T01:00:00.000Z",
        completedAt: "2026-08-23T01:00:02.000Z",
        userEntry: {
          id: "request-1:user",
          requestId: "request-1",
          timestamp: "2026-08-23T01:00:00.000Z",
          kind: "user.message",
          content: "我住在上海。",
        },
        assistantEntry: {
          id: "request-1:assistant",
          requestId: "request-1",
          timestamp: "2026-08-23T01:00:02.000Z",
          kind: "assistant.decision",
          xml: "<agent_result><final_answer>知道了。</final_answer></agent_result>",
        },
        terminal: { kind: "FinalAnswer", content: "知道了。" },
        executedTools: [],
      });

      const result = await recallContinuity(
        { query: "住在上海" },
        {
          store: new AgentContinuitySqliteStore(kernel),
          sourceRepository,
          temporalMemoryStore: new AgentTemporalMemorySqliteStore(kernel),
          timeZone: "Asia/Shanghai",
          identity: testContinuityIdentity(workspaceRoot),
          ranking: AgentContinuityRecallRankingDefaults,
        },
      );
      expect(result.records.item).toEqual([
        expect.objectContaining({
          kind: "physical_source",
          sourceRefs: { item: [expect.stringMatching(/^senera:\/\/memory-source\//u)] },
        }),
      ]);
      expect(result.episodes.item).toEqual([
        expect.objectContaining({
          requestId: "request-1",
          anchorSourceRefs: { item: [expect.stringMatching(/^senera:\/\/memory-source\//u)] },
        }),
      ]);
      expect(result.sources.item).toHaveLength(2);
      expect(result.sources.item).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceKind: "user_message", text: "我住在上海。", anchor: true }),
          expect.objectContaining({ sourceKind: "assistant_final", text: "知道了。", anchor: false }),
        ]),
      );
    } finally {
      kernel.close();
    }
  });

  test("expands a physical match into an explicit neighboring-turn window", async () => {
    const workspaceRoot = createWorkspace();
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: databasePath(workspaceRoot),
      contract: AgentMemoryDatabaseContract,
    });
    const sourceRepository = new SqliteAgentMemorySourceRepository(kernel);
    try {
      for (const index of [1, 2, 3]) {
        sourceRepository.recordCompletedTurn({
          sessionId: "session-window",
          requestId: `request-${index}`,
          startedAt: `2026-08-23T01:0${index}:00.000Z`,
          completedAt: `2026-08-23T01:0${index}:02.000Z`,
          userEntry: {
            id: `request-${index}:user`,
            requestId: `request-${index}`,
            timestamp: `2026-08-23T01:0${index}:00.000Z`,
            kind: "user.message",
            content: `用户消息 ${index}`,
          },
          assistantEntry: {
            id: `request-${index}:assistant`,
            requestId: `request-${index}`,
            timestamp: `2026-08-23T01:0${index}:02.000Z`,
            kind: "assistant.decision",
            xml: `<agent_result><final_answer>助手回复 ${index}</final_answer></agent_result>`,
          },
          terminal: { kind: "FinalAnswer", content: `助手回复 ${index}` },
          executedTools: [],
        });
      }
      const anchor = sourceRepository
        .listEpisodes("session-window")
        .find((episode) => episode.requestId === "request-2");
      expect(anchor).toBeDefined();
      const anchorSource = sourceRepository
        .listSources(anchor!.uri)
        .find((source) => source.sourceKind === "user_message");
      expect(anchorSource).toBeDefined();

      const result = await recallContinuity(
        { refs: [anchorSource!.uri], before: 1, after: 1 },
        {
          store: new AgentContinuitySqliteStore(kernel),
          sourceRepository,
          temporalMemoryStore: new AgentTemporalMemorySqliteStore(kernel),
          timeZone: "Asia/Shanghai",
          identity: testContinuityIdentity(workspaceRoot),
          sessionId: "session-window",
          ranking: AgentContinuityRecallRankingDefaults,
        },
      );

      expect(result.episodes.item.map((episode) => episode.requestId)).toEqual(["request-1", "request-2", "request-3"]);
      expect(result.sources.item.filter((source) => source.anchor).map((source) => source.sourceRef)).toEqual([
        anchorSource!.uri,
      ]);
      expect(result.sources.item.map((source) => source.text)).toEqual([
        "用户消息 1",
        "助手回复 1",
        "用户消息 2",
        "助手回复 2",
        "用户消息 3",
        "助手回复 3",
      ]);

      const reread = await recallContinuity(
        { refs: [result.episodes.item[1]!.episodeRef] },
        {
          store: new AgentContinuitySqliteStore(kernel),
          sourceRepository,
          temporalMemoryStore: new AgentTemporalMemorySqliteStore(kernel),
          timeZone: "Asia/Shanghai",
          identity: testContinuityIdentity(workspaceRoot),
          sessionId: "session-window",
          ranking: AgentContinuityRecallRankingDefaults,
        },
      );
      expect(reread.episodes.item.map((episode) => episode.requestId)).toEqual(["request-2"]);
      expect(reread.sources.item.map((source) => source.text)).toEqual(["用户消息 2", "助手回复 2"]);
    } finally {
      kernel.close();
    }
  });

  test("dereferences a source reference without requiring a duplicate natural-language query", async () => {
    const workspaceRoot = createWorkspace();
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: databasePath(workspaceRoot),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentContinuitySqliteStore(kernel);
    const sourceRepository = new SqliteAgentMemorySourceRepository(kernel);
    try {
      store.recordObservation({
        id: "reference-only",
        uri: "senera://continuity-learning/reference-only",
        kind: "learning.record",
        summary: "用户住在上海。",
        payload: { kind: "fact", until: "permanent" },
        sourceRefs: ["senera://memory-source/reference-only"],
        watermark: "wm-reference-only",
        scope: { kind: "workspace", id: workspaceRoot },
        authority: "user_explicit",
        confidence: 1,
        occurredAt: "2026-08-23T01:00:00.000Z",
        observedAt: "2026-08-23T01:00:01.000Z",
        createdAtMs: Date.parse("2026-08-23T01:00:01.000Z"),
      });

      const result = await recallContinuity(
        { refs: ["senera://continuity-learning/reference-only"] },
        {
          store,
          sourceRepository,
          temporalMemoryStore: new AgentTemporalMemorySqliteStore(kernel),
          timeZone: "Asia/Shanghai",
          identity: testContinuityIdentity(workspaceRoot),
          ranking: AgentContinuityRecallRankingDefaults,
        },
      );

      expect(result.query).toBeUndefined();
      expect(result.records.item).toEqual([
        expect.objectContaining({ recordUri: "senera://continuity-learning/reference-only" }),
      ]);
    } finally {
      kernel.close();
    }
  });

  test("applies a requested time range to exact learning references", async () => {
    const workspaceRoot = createWorkspace();
    const kernel = new AgentSqliteDatabaseKernel({
      databasePath: databasePath(workspaceRoot),
      contract: AgentMemoryDatabaseContract,
    });
    const store = new AgentContinuitySqliteStore(kernel);
    const sourceRepository = new SqliteAgentMemorySourceRepository(kernel);
    const identity = testContinuityIdentity(workspaceRoot);
    try {
      sourceRepository.recordCompletedTurn({
        sessionId: "range-session",
        requestId: "range-request",
        startedAt: "2026-08-23T00:59:00.000Z",
        completedAt: "2026-08-23T01:00:00.000Z",
        userEntry: {
          id: "range-request:user",
          requestId: "range-request",
          timestamp: "2026-08-23T00:59:00.000Z",
          kind: "user.message",
          content: "范围测试证据",
        },
        assistantEntry: {
          id: "range-request:assistant",
          requestId: "range-request",
          timestamp: "2026-08-23T01:00:00.000Z",
          kind: "assistant.decision",
          xml: "<agent_result><final_answer>好的。</final_answer></agent_result>",
        },
        terminal: { kind: "FinalAnswer", content: "好的。" },
        executedTools: [],
      });
      const rangeEpisode = sourceRepository.listEpisodes("range-session")[0];
      expect(rangeEpisode).toBeDefined();
      const sourceRef = sourceRepository.listSources(rangeEpisode!.uri)[0]?.uri;
      expect(sourceRef).toBeDefined();

      for (const [id, occurredAt] of [
        ["outside", "2026-08-20T01:00:00.000Z"],
        ["inside", "2026-08-23T01:00:00.000Z"],
      ] as const) {
        store.recordObservation({
          id,
          uri: `senera://continuity-learning/${id}`,
          kind: "learning.record",
          summary: `范围测试 ${id}`,
          payload: { kind: "fact", until: "permanent" },
          sourceRefs: [sourceRef!],
          watermark: `wm-${id}`,
          scope: { kind: "workspace", id: workspaceRoot },
          authority: "user_explicit",
          confidence: 1,
          occurredAt,
          observedAt: occurredAt,
          createdAtMs: Date.parse(occurredAt),
        });
      }

      const result = await recallContinuity(
        {
          refs: ["senera://continuity-learning/outside"],
          from: "2026-08-23",
          to: "2026-08-23",
        },
        {
          store,
          sourceRepository,
          temporalMemoryStore: new AgentTemporalMemorySqliteStore(kernel),
          timeZone: "Asia/Shanghai",
          identity,
          ranking: AgentContinuityRecallRankingDefaults,
        },
      );

      expect(result.records.item).toEqual([]);
    } finally {
      kernel.close();
    }
  });
});

function createWorkspace(): string {
  const workspace = createTemporaryDirectory("senera-continuity-tools");
  workspaces.add(workspace);
  return workspace;
}

function databasePath(workspaceRoot: string): string {
  return resolveAgentWorkspaceLayout(workspaceRoot).databases.memory;
}

function toolContext(workspaceRoot: string): AgentHostToolContext {
  return {
    tool: { name: "MemoryWriteTool" },
    workspaceRoot,
    continuityIdentity: testContinuityIdentity(workspaceRoot),
    sessionId: "session-1",
    requestId: "request-1",
    toolCallId: "call-1",
  } as AgentHostToolContext;
}

function createSemanticRecallFixture(): {
  readonly workspaceRoot: string;
  readonly kernel: AgentSqliteDatabaseKernel;
  readonly store: AgentContinuitySqliteStore;
  readonly sourceRepository: SqliteAgentMemorySourceRepository;
  readonly temporalMemoryStore: AgentTemporalMemorySqliteStore;
  readonly observation: { readonly uri: string; readonly summary: string };
} {
  const workspaceRoot = createWorkspace();
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: databasePath(workspaceRoot),
    contract: AgentMemoryDatabaseContract,
  });
  const store = new AgentContinuitySqliteStore(kernel);
  const observation = {
    uri: "senera://continuity-learning/semantic-cancellation",
    summary: "用户喜欢无糖美式咖啡。",
  };
  store.recordObservation({
    id: "semantic-cancellation",
    uri: observation.uri,
    kind: "learning.record",
    summary: observation.summary,
    payload: { kind: "fact", until: "permanent" },
    sourceRefs: ["senera://memory-source/semantic-cancellation"],
    watermark: "wm-semantic-cancellation",
    scope: { kind: "workspace", id: workspaceRoot },
    authority: "user_explicit",
    confidence: 1,
    occurredAt: "2026-08-23T01:00:00.000Z",
    observedAt: "2026-08-23T01:00:01.000Z",
    createdAtMs: Date.parse("2026-08-23T01:00:01.000Z"),
  });
  return {
    workspaceRoot,
    kernel,
    store,
    sourceRepository: new SqliteAgentMemorySourceRepository(kernel),
    temporalMemoryStore: new AgentTemporalMemorySqliteStore(kernel),
    observation,
  };
}

function semanticRecallOptions(
  fixture: ReturnType<typeof createSemanticRecallFixture>,
  semanticRecall: AgentContinuitySemanticRecall,
  input: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
) {
  return {
    store: fixture.store,
    sourceRepository: fixture.sourceRepository,
    temporalMemoryStore: fixture.temporalMemoryStore,
    timeZone: "Asia/Shanghai",
    identity: testContinuityIdentity(fixture.workspaceRoot),
    ranking: AgentContinuityRecallRankingDefaults,
    semanticRecall,
    semantic: {
      Enabled: true,
      TimeoutMs: input.timeoutMs ?? 1_000,
      ScoreFloor: 0,
      MinQueryCharacters: 0,
    },
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

function vectorEmbeddingClient(): AgentContinuitySemanticEmbeddingClient {
  return {
    embed: async (request) => ({
      model: AgentLocalEmbeddingModelName,
      vectors: request.input.map(() => [1, 0, 0]),
    }),
  };
}

function blockingSemanticQueryClient(onQueryStarted?: () => void): AgentContinuitySemanticEmbeddingClient {
  return {
    embed: async (request) => {
      if (request.role === "document") {
        return { model: AgentLocalEmbeddingModelName, vectors: request.input.map(() => [1, 0, 0]) };
      }
      onQueryStarted?.();
      return new Promise((_, reject) => {
        const signal = request.signal;
        if (!signal) {
          reject(new Error("The semantic query should receive an abort signal."));
          return;
        }
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  };
}
