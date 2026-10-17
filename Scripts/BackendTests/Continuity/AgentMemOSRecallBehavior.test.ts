import path from "node:path";
import { Ajv } from "ajv";
import { z } from "zod";
import { MemOS } from "@mem-os/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentContinuityMemOSRuntime } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemOSRuntime.js";
import { AgentMemOSEmbeddingRuntime } from "../../../Source/AgentSystem/Continuity/AgentMemOSEmbeddingRuntime.js";
import { AgentMemOSSemanticLearningRuntime } from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticLearningRuntime.js";
import { AgentContinuityMemoryService } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryService.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { AgentMemOSTags } from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticTypes.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentBackgroundLearningRequestLedger } from "../../../Source/AgentSystem/Memory/AgentBackgroundLearningRequestLedger.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { InMemoryAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { createModelProvider, createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import {
  ContinuityRecallArgumentsSchema,
  recallContinuity,
} from "../../../Source/AgentSystem/Continuity/AgentContinuityToolRuntime.js";
import type { AgentToolSearchEpisode } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryTypes.js";
import { createToolProcessSuccessResponse } from "../../../Source/AgentSystem/ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentInvalidModelToolArgumentsError } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelFailureMapper.js";

const cleanups: Array<() => Promise<void>> = [];
const tokenBudget = { maxTokens: 16384, estimateTokens: (text: string) => text.length };
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

async function fixture() {
  const root = createTemporaryDirectory("senera-memos-recall");
  const databasePath = path.join(root, "memos.sqlite");
  const sdk = new MemOS({ dbPath: databasePath, experimental: { namespaces: true } });
  await sdk.init();
  const add = async (summary: string, tags: string[], occurredAt: string, namespace = "test") =>
    (
      await sdk.store(summary, {
        summary,
        type: "context",
        namespace,
        tags: [AgentMemOSTags.semantic, ...tags],
        validFrom: Date.parse(occurredAt),
      })
    ).node;
  const old = await add("old beef knowledge", [AgentMemOSTags.knowledge], "2026-08-01T00:00:00Z");
  await add("recent beef knowledge", [AgentMemOSTags.knowledge], "2026-10-08T00:00:00Z");
  await add("immutable raw turn", [AgentMemOSTags.fragment, "day:2026-10-08"], "2026-10-08T00:00:00Z");
  const digest = await add("October digest", [AgentMemOSTags.monthlyDigest, "month:2026-10"], "2026-10-09T00:00:00Z");
  const foreign = await add("foreign memory", [AgentMemOSTags.knowledge], "2026-10-08T00:00:00Z", "other");
  await sdk.close();
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: path.join(root, "ledger.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const repository = new InMemoryAgentMemorySourceRepository();
  const embed = vi.fn(async (request: { input: readonly string[]; role: "query" | "document" }) => ({
    model: "test-encoder",
    vectors: request.input.map((text) =>
      text === "old beef knowledge\nold beef knowledge"
        ? [1, 0, 0, 0]
        : text === "recent beef knowledge\nrecent beef knowledge"
          ? [0, 1, 0, 0]
          : text === "October digest\nOctober digest"
            ? [0, 0, 1, 0]
            : [0, 0, 0, 1],
    ),
  }));
  const runtimes: AgentContinuityMemOSRuntime[] = [];
  const createRuntime = () => {
    const runtime = new AgentContinuityMemOSRuntime({
      databasePath,
      namespace: "test",
      embeddingClient: { providerId: "test", dimensions: 4, embed },
      embeddingModel: () => "test-encoder",
      autoLinkThreshold: 0.75,
      recallDedupeConfig: () => ({ threshold: 0.92, maxPairs: 10000 }),
      sourceRepository: repository,
      learningRequests: new AgentBackgroundLearningRequestLedger(kernel),
      semanticModelProvider: () => createModelProvider(),
      semanticScopeKey: "test",
      semanticPolicy: () => ({
        enabled: false,
        maxAttempts: 2,
        retryBaseMs: 1,
        retryMaxDelayMs: 1,
        maxJobsPerDrain: 1,
      }),
      semanticConfig: () => ({
        fragmentHistoryTurns: 6,
        knowledgeCandidateLimit: 8,
        assistantPreviewTokens: 256,
        digestInputTokenBudget: 8192,
        digestSummaryTokenLimit: 50,
      }),
    });
    runtimes.push(runtime);
    return runtime;
  };
  const createService = (runtime: AgentContinuityMemOSRuntime) =>
    new AgentContinuityMemoryService({
      store: new AgentContinuitySqliteStore(kernel),
      memos: runtime,
      recallConfig: () => ({ PromptBudget: { MaxTokens: 16384 } }),
    });
  cleanups.push(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.close()));
    kernel.close();
    repository.close();
    removeDirectory(root);
  });
  return { databasePath, old, digest, foreign, createRuntime, createService, embed };
}

describe("native MemOS recall", () => {
  test("keeps detached semantic-learning failures out of the foreground flush boundary", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const flush = vi
      .spyOn(AgentMemOSSemanticLearningRuntime.prototype, "flush")
      .mockRejectedValueOnce(new AgentInvalidModelToolArgumentsError("MemOSPeriodDigest", ["summary"]));
    try {
      await expect(runtime.flush()).resolves.toBeUndefined();
    } finally {
      flush.mockRestore();
    }
  });

  test("keeps MemOS initialization failures detached unless the boundary explicitly surfaces them", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const failure = Promise.reject(new Error("MemOS initialization failed"));
    void failure.catch(() => {});
    (runtime as unknown as { ready: Promise<void> }).ready = failure;

    await expect(runtime.flush()).resolves.toBeUndefined();
    await expect(runtime.search("unavailable memory")).resolves.toEqual([]);
    await expect(runtime.flush({ surfaceFailures: true })).rejects.toThrow("MemOS initialization failed");
  });

  test("keeps detached embedding flush failures out of the foreground boundary", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    await runtime.flush();
    const flushEmbeddings = vi
      .spyOn(AgentMemOSEmbeddingRuntime.prototype, "flushEmbeddings")
      .mockRejectedValue(new Error("embedding queue unavailable"));
    try {
      await expect(runtime.flush()).resolves.toBeUndefined();
      await expect(runtime.flush({ surfaceFailures: true })).rejects.toThrow("embedding queue unavailable");
    } finally {
      flushEmbeddings.mockRestore();
    }
  });

  test("keeps detached embedding failures out of foreground recall", async () => {
    const f = await fixture();
    f.embed.mockImplementation(async (request) => {
      if (request.role === "document") throw new Error("detached document embedding failed");
      return {
        model: "test-encoder",
        vectors: request.input.map(() => [0, 0, 0, 1]),
      };
    });
    const runtime = f.createRuntime();

    await expect(runtime.search("beef")).resolves.toEqual(expect.any(Array));
    await expect(runtime.flush({ surfaceFailures: true })).rejects.toThrow("MemOS embedding queue has failed nodes");
  });

  test("degrades prompt continuity when derived recall fails", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    vi.spyOn(runtime, "search").mockRejectedValueOnce(new Error("derived recall index unavailable"));

    await expect(
      f.createService(runtime).liveContext({
        sessionId: "session",
        requestId: "request",
        userInput: "继续上一个任务",
        historicalTokenBudget: { maxTokens: 1024, estimateTokens: (text) => text.length },
      }),
    ).resolves.toMatchObject({ enabled: true, query: "继续上一个任务", eventCandidates: [], periodDigests: [] });
  });

  test("publishes reference constraints and decodes references at the tool boundary", () => {
    const validate = new Ajv({ strict: false }).compile(
      z.toJSONSchema(ContinuityRecallArgumentsSchema, { target: "draft-7", io: "input" }),
    );
    expect(validate({ refs: ["memos:knowledge-1"] })).toBe(true);
    expect(ContinuityRecallArgumentsSchema.parse({ refs: ["memos:knowledge-1"] }).refs).toEqual(["knowledge-1"]);
    for (const reference of ["memos:", "knowledge-1", "memory:knowledge-1"]) {
      expect(validate({ refs: [reference] })).toBe(false);
      expect(ContinuityRecallArgumentsSchema.safeParse({ refs: [reference] }).success).toBe(false);
    }
  });

  test("reads older exact references directly and rejects foreign namespace records", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const args = ContinuityRecallArgumentsSchema.parse({ refs: ["memos:" + f.old.id, "memos:" + f.foreign.id] });
    const results = await recallContinuity(args, { memos: runtime, tokenBudget });
    expect(results.records.item.map((record) => record.uri)).toEqual(["memos:" + f.old.id]);
    expect(results.records.item[0]?.summary).toMatch(/^\[2026-08-01 08:00\] /);
  });

  test("filters the complete time range before budgeting and uses calendar overlap for digests", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const results = await recallContinuity({ from: "2026-08-01", to: "2026-08-01" }, { memos: runtime, tokenBudget });
    expect(results.records.item.map((record) => record.uri)).toEqual(["memos:" + f.old.id]);
    const month = await recallContinuity({ from: "2026-10-31", to: "2026-10-31" }, { memos: runtime, tokenBudget });
    expect(month.records.item.map((record) => record.uri)).toEqual(["memos:" + f.digest.id]);
  });

  test("normal context excludes raw fragments and delivery survives restart while updates can be delivered again", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const service = f.createService(runtime);
    const input = {
      sessionId: "session",
      historicalTokenBudget: { maxTokens: 2048, estimateTokens: (text: string) => Math.ceil(text.length / 4) },
    };
    const memory = await service.liveContext(input);
    expect(memory.eventCandidates).toHaveLength(2);
    expect(memory.periodDigests).toHaveLength(1);
    expect(service.commitLiveContextDelivery({ sessionId: "session", memory })).toBe(3);
    expect((await service.liveContext(input)).eventCandidates).toHaveLength(0);
    expect((await service.liveContext(input)).periodDigests).toHaveLength(0);
    await runtime.close();
    const sdk = new MemOS({ dbPath: f.databasePath });
    await sdk.init();
    await sdk.update(f.old.id, { summary: "updated beef knowledge", content: "updated beef knowledge" });
    await sdk.close();
    const restarted = f.createRuntime();
    const next = await f.createService(restarted).liveContext(input);
    expect(next.eventCandidates.map((entry) => entry.summary)).toEqual(["updated beef knowledge"]);
    expect(next.periodDigests).toHaveLength(0);
  });

  test("a stale delivery receipt cannot suppress memories after context invalidation", async () => {
    const f = await fixture();
    const service = f.createService(f.createRuntime());
    const memory = await service.liveContext({
      sessionId: "session",
      historicalTokenBudget: { maxTokens: 2048, estimateTokens: (text) => text.length },
    });
    service.invalidateSessionContext("session");
    expect(service.commitLiveContextDelivery({ sessionId: "session", memory })).toBe(0);
  });

  test("requires an explicit token budget and uses document/query encoder roles", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const service = f.createService(runtime);
    expect((await service.liveContext({ sessionId: "session" })).eventCandidates).toEqual([]);
    runtime.recordToolRoutingMemory({
      projectId: "project",
      sessionId: "session",
      requestId: "request",
      episode: scenario(),
    });
    await runtime.search("beef");
    expect(f.embed.mock.calls.some(([request]) => request.role === "query")).toBe(true);
    expect(f.embed.mock.calls.some(([request]) => request.role === "document")).toBe(true);
    const recalled = await recallContinuity({ query: "beef" }, { memos: runtime, tokenBudget });
    expect(recalled.records.item[0]).toEqual(
      expect.objectContaining({
        scores: expect.objectContaining({
          keyword: expect.any(Number),
          semantic: expect.any(Number),
          hybrid: expect.any(Number),
        }),
      }),
    );
    await runtime.flush();
  });

  test("identical scenarios belong to their own turns while replay updates the same turn", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const episode = scenario();
    runtime.recordToolRoutingMemory({ projectId: "project", sessionId: "first", requestId: "one", episode });
    runtime.recordToolRoutingMemory({ projectId: "project", sessionId: "second", requestId: "two", episode });
    await runtime.flush();
    expect(await runtime.listToolRouting("project", 8)).toHaveLength(2);
    runtime.recordToolRoutingMemory({
      projectId: "project",
      sessionId: "second",
      requestId: "two",
      episode: { ...episode, finalScore: 0.7 },
    });
    await runtime.flush();
    expect(await runtime.listToolRouting("project", 8)).toHaveLength(2);
    runtime.deleteSession("first");
    await runtime.flush();
    expect(await runtime.listToolRouting("project", 8)).toHaveLength(1);
  });

  test("budgets the complete explicit-recall envelope and keeps smaller records when one record is oversized", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const args = { refs: [f.old.id] };
    const baseline = await recallContinuity(args, { memos: runtime, tokenBudget });
    const maxTokens = tokenBudget.estimateTokens(JSON.stringify(createToolProcessSuccessResponse(baseline)));
    const matches = await runtime.recall({ nodeIds: [f.old.id] });
    const match = matches[0]!;
    const oversized = {
      ...match,
      memory: { ...match.memory, node: { ...match.memory.node, id: "oversized", content: "完整内容。".repeat(5000) } },
    };
    const result = await recallContinuity(args, {
      memos: { recall: async () => [oversized, match] },
      tokenBudget: { ...tokenBudget, maxTokens },
    });
    expect(result.records.item.map((record) => record.uri)).toEqual(["memos:" + f.old.id]);
    expect(result.budget).toMatchObject({ matchedRecords: 2, returnedRecords: 1 });
    expect(tokenBudget.estimateTokens(JSON.stringify(createToolProcessSuccessResponse(result)))).toBeLessThanOrEqual(
      maxTokens,
    );
  });
});

function scenario(): AgentToolSearchEpisode {
  return {
    query: "completed scenario",
    queryTokens: [],
    plannerTags: [],
    candidates: [],
    chosenTools: [],
    activeSkills: [],
    calls: [],
    outcome: "success",
    finalScore: 1,
    finalOutcome: {
      toolExecutionSucceeded: true,
      producedEvidence: false,
      producedArtifact: false,
      changedWorkspace: false,
    },
    projectId: "project",
    timestamp: Date.parse("2026-10-08T00:00:00Z"),
  };
}
