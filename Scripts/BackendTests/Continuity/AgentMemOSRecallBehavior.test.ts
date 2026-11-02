import { AgentMemoryDiaryStore } from "../../../Source/AgentSystem/Continuity/AgentMemoryDiaryStore.js";
import { AgentMemoryDiaryDefaults } from "../../../Source/AgentSystem/Continuity/AgentMemoryDiaryContract.js";
import path from "node:path";
import { MemOS, type MemoryType } from "@mem-os/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentContinuityMemOSRuntime } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemOSRuntime.js";
import { AgentMemOSEmbeddingRuntime } from "../../../Source/AgentSystem/Continuity/AgentMemOSEmbeddingRuntime.js";
import { AgentMemOSSemanticLearningRuntime } from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticLearningRuntime.js";
import { AgentContinuityMemoryService } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryService.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import {
  AgentMemOSSchemaVersion,
  AgentMemOSTags,
} from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticTypes.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentBackgroundLearningRequestLedger } from "../../../Source/AgentSystem/Memory/AgentBackgroundLearningRequestLedger.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { InMemoryAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { createModelProvider, createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { recallContinuity } from "../../../Source/AgentSystem/Continuity/AgentContinuityToolRuntime.js";
import type { AgentToolSearchEpisode } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchMemoryTypes.js";
import { createToolProcessSuccessResponse } from "../../../Source/AgentSystem/ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentInvalidModelToolArgumentsError } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelFailureMapper.js";
import {
  loadSystemToolContractByName,
  materializeSystemToolArguments,
} from "../SystemTools/SystemToolContractTestSupport.js";

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
  const add = async (
    summary: string,
    tags: string[],
    occurredAt: string,
    namespace = "test",
    type: MemoryType = "context",
  ) => {
    const day = tags.find((tag) => tag.startsWith("day:"));
    const month = tags.find((tag) => tag.startsWith("month:"));
    const isPeriod = tags.includes(AgentMemOSTags.dailyDigest) || tags.includes(AgentMemOSTags.monthlyDigest);
    const periodKey = (day ?? month)?.slice((day ?? month)!.indexOf(":") + 1);
    const granularity = day ? "day" : "month";
    const periodStart =
      day && periodKey
        ? `${periodKey}T00:00:00+08:00`
        : month && periodKey
          ? `${periodKey}-01T00:00:00+08:00`
          : undefined;
    return (
      await sdk.store(summary, {
        summary,
        type,
        namespace,
        tags: [AgentMemOSTags.semantic, ...tags],
        validFrom: Date.parse(occurredAt),
        metadata: isPeriod
          ? {
              senera_schema: AgentMemOSSchemaVersion,
              senera_domain: "semantic",
              senera_scope: "period",
              senera_period_granularity: granularity,
              senera_period_key: periodKey!,
              senera_period_start: periodStart!,
              senera_period_end:
                day && periodKey
                  ? `${addUtcDays(periodKey, 1)}T00:00:00+08:00`
                  : `${addUtcMonths(periodKey!, 1)}-01T00:00:00+08:00`,
            }
          : {
              senera_schema: AgentMemOSSchemaVersion,
              senera_domain: "semantic",
              senera_scope: "workspace",
              senera_operation_key: `test:${summary}`,
              senera_episode_uri: `senera://episode/${summary}`,
              senera_source_uris: [`senera://source/${summary}`],
              senera_source_session_ids: ["source-session"],
              senera_source_request_ids: ["source-request"],
            },
      })
    ).node;
  };
  const old = await add("old beef knowledge", [AgentMemOSTags.knowledge], "2026-08-01T00:00:00Z", "test", "fact");
  await add("recent beef knowledge", [AgentMemOSTags.knowledge], "2026-10-08T00:00:00Z", "test", "preference");
  await add("immutable raw turn", [AgentMemOSTags.fragment, "day:2026-10-08"], "2026-10-08T00:00:00Z");
  const digest = await add("October digest", [AgentMemOSTags.monthlyDigest, "month:2026-10"], "2026-10-09T00:00:00Z");
  const legacyCustom = await add(
    "legacy custom memory",
    [AgentMemOSTags.knowledge],
    "2026-10-10T00:00:00Z",
    "test",
    "custom",
  );
  const foreign = await add("foreign memory", [AgentMemOSTags.knowledge], "2026-10-08T00:00:00Z", "other", "fact");
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
      retentionPolicy: () => ({ FactDays: 7, ContextDays: 1 }),
      retentionInputTokenBudget: () => 8192,
      diary: { store: new AgentMemoryDiaryStore(path.join(root, "diary")), config: () => AgentMemoryDiaryDefaults },
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
        fragmentSummaryTokenLimit: 50,
      }),
    });
    runtimes.push(runtime);
    return runtime;
  };
  const createService = (runtime: AgentContinuityMemOSRuntime) =>
    new AgentContinuityMemoryService({
      store: new AgentContinuitySqliteStore(kernel),
      memos: runtime,
      assessRelevance: async ({ candidates }) => candidates,
      recallConfig: () => ({ PromptBudget: { MaxTokens: 16384 } }),
    });
  cleanups.push(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.close()));
    kernel.close();
    repository.close();
    removeDirectory(root);
  });
  return { databasePath, old, digest, foreign, legacyCustom, createRuntime, createService, embed };
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function addUtcMonths(month: string, months: number): string {
  const value = new Date(`${month}-01T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 7);
}

describe("native MemOS recall", () => {
  test("isolates task records before ranking despite a shared cached text query", async () => {
    const f = await fixture();
    const sdk = new MemOS({ dbPath: f.databasePath, experimental: { namespaces: true } });
    await sdk.init();
    const records = new Map<string, string>();
    for (const taskId of ["task-a", "task-b"]) {
      const { node } = await sdk.store(`investigate ${taskId}`, {
        type: "context",
        summary: `investigate ${taskId}`,
        namespace: "test",
        tags: [AgentMemOSTags.semantic, AgentMemOSTags.knowledge],
        metadata: {
          senera_schema: AgentMemOSSchemaVersion,
          senera_domain: "semantic",
          senera_scope: "session",
          senera_subject_id: "owner",
          senera_task_id: taskId,
        },
      });
      records.set(taskId, node.id);
    }
    await sdk.close();
    const runtime = f.createRuntime();
    await runtime.search("investigate");
    const first = await runtime.taskMemory("task-a", "investigate");
    const second = await runtime.taskMemory("task-b", "investigate");
    expect(first.map((result) => result.memory.node.id)).toEqual([records.get("task-a")]);
    expect(second.map((result) => result.memory.node.id)).toEqual([records.get("task-b")]);
    expect(first[0]?.memory.scores).toHaveProperty("semantic");
    expect(await runtime.taskMemory("missing-task", "investigate")).toEqual([]);
  });
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

  test("surfaces unreadable storage to recall without turning a detached flush failure into an empty snapshot", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const failure = Promise.reject(new Error("MemOS initialization failed"));
    void failure.catch(() => {});
    (runtime as unknown as { ready: Promise<void> }).ready = failure;

    await expect(runtime.flush()).resolves.toBeUndefined();
    await expect(runtime.search("unavailable memory")).rejects.toThrow("MemOS initialization failed");
    await expect(runtime.searchRecent()).rejects.toThrow("MemOS initialization failed");
    await expect(runtime.flush({ surfaceFailures: true })).rejects.toThrow("MemOS initialization failed");
  });

  test("retries a real recall after an embedding read barrier fails instead of freezing a false empty result", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    await runtime.flush();
    const service = f.createService(runtime);
    const input = {
      sessionId: "session",
      requestId: "failed-read",
      userInput: "beef",
      historicalTokenBudget: tokenBudget,
    };
    const flush = vi.spyOn(MemOS.prototype, "flushEmbeddings").mockRejectedValue(new Error("read barrier unavailable"));
    try {
      await expect(runtime.searchRecent()).rejects.toThrow("read barrier unavailable");
      expect((await service.liveContext(input)).eventCandidates).toEqual([]);
    } finally {
      flush.mockRestore();
    }
    const recovered = await service.liveContext({ ...input, requestId: "recovered" });
    expect(recovered.eventCandidates.length).toBeGreaterThan(0);
    expect(recovered.diagnostics?.snapshotReused).toBe(false);
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
    ).resolves.toMatchObject({ enabled: true, query: "继续上一个任务", eventCandidates: [] });
  });

  test("selects automatic semantic memory independently of transient topic state", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const search = vi.spyOn(runtime, "search");
    const recent = vi.spyOn(runtime, "searchRecent");

    const memory = await f.createService(runtime).liveContext({
      sessionId: "session",
      requestId: "request",
      userInput: "开始一个完全不同的新任务",
      historicalTokenBudget: tokenBudget,
    });

    expect(search).toHaveBeenCalled();
    expect(recent).toHaveBeenCalled();
    expect(memory).toMatchObject({
      enabled: true,
      query: "开始一个完全不同的新任务",
    });
    expect(memory.eventCandidates).toHaveLength(1);
    expect(memory.eventCandidates.every((entry) => entry.type === "preference")).toBe(true);
    expect(memory.relatedCandidates?.some((entry) => entry.id === f.old.id)).toBe(false);
  });

  test("publishes reference constraints and decodes references inside the runtime boundary", () => {
    const contract = loadSystemToolContractByName("MemoryRecallTool");
    expect(materializeSystemToolArguments(contract, { refs: ["memos:knowledge-1"] }).ok).toBe(true);
    for (const reference of ["memos:", "knowledge-1", "memory:knowledge-1"]) {
      expect(materializeSystemToolArguments(contract, { refs: [reference] }).ok).toBe(false);
    }
  });

  test("reads older exact references directly and rejects foreign namespace records", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const results = await recallContinuity(
      { refs: ["memos:" + f.old.id, "memos:" + f.foreign.id] },
      { memos: runtime, tokenBudget },
    );
    expect(results.records.item.map((record) => record.uri)).toEqual(["memos:" + f.old.id]);
    expect(results.records.item[0]?.occurredAt).toBe("2026-08-01T08:00:00+08:00");
    expect(results.records.item[0]?.summary).toBe(f.old.summary);
  });

  test("explicit recall retains legacy semantic types without placing them in automatic context", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const recalled = await recallContinuity({ refs: [`memos:${f.legacyCustom.id}`] }, { memos: runtime, tokenBudget });
    expect(recalled.records.item).toEqual([
      expect.objectContaining({ uri: `memos:${f.legacyCustom.id}`, type: "custom" }),
    ]);
    const automatic = await f.createService(runtime).liveContext({
      sessionId: "legacy-custom",
      historicalTokenBudget: { maxTokens: 2048, estimateTokens: (text) => text.length },
    });
    expect(automatic.eventCandidates.map((entry) => entry.id)).not.toContain(f.legacyCustom.id);
  });

  test("explicit recall never exposes internal turn fragments", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const sdk = new MemOS({ dbPath: f.databasePath, experimental: { namespaces: true } });
    await sdk.init();
    const fragment = (
      await sdk.store("private fragment", {
        summary: "private fragment",
        type: "context",
        namespace: "test",
        tags: [AgentMemOSTags.semantic, AgentMemOSTags.fragment],
      })
    ).node;
    await sdk.close();
    expect((await runtime.recall({ nodeIds: [fragment.id] })).map((entry) => entry.memory.node.id)).toEqual([]);
  });

  test("filters the complete time range before budgeting and uses calendar overlap for digests", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const results = await recallContinuity({ from: "2026-08-01", to: "2026-08-01" }, { memos: runtime, tokenBudget });
    expect(results.range).toEqual({
      from: "2026-08-01T00:00:00+08:00",
      to: "2026-08-02T00:00:00+08:00",
      timeZone: "Asia/Shanghai",
    });
    expect(results.records.item.map((record) => record.uri)).toEqual(["memos:" + f.old.id]);
    const month = await recallContinuity({ from: "2026-10-31", to: "2026-10-31" }, { memos: runtime, tokenBudget });
    expect(month.records.item.map((record) => record.uri)).toEqual(["memos:" + f.digest.id]);
  });

  test("normal context preserves the frozen automatic-memory snapshot across a runtime restart", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const service = f.createService(runtime);
    const input = {
      sessionId: "session",
      userInput: "beef",
      historicalTokenBudget: { maxTokens: 2048, estimateTokens: (text: string) => Math.ceil(text.length / 4) },
    };
    const memory = await service.liveContext(input);
    expect(memory.eventCandidates).toHaveLength(1);
    expect((await service.liveContext(input)).eventCandidates).toHaveLength(1);
    await runtime.close();
    const sdk = new MemOS({ dbPath: f.databasePath });
    await sdk.init();
    await sdk.update(f.old.id, { summary: "updated beef knowledge", content: "updated beef knowledge" });
    await sdk.close();
    const restarted = f.createRuntime();
    const next = await f.createService(restarted).liveContext(input);
    expect(next.eventCandidates.map((entry) => entry.summary)).toEqual(
      memory.eventCandidates.map((entry) => entry.summary),
    );
  });

  test("commits the automatic-memory snapshot only after a final positive budget", async () => {
    const f = await fixture();
    const service = f.createService(f.createRuntime());
    const sessionId = "budget-finalization";
    const budget = { maxTokens: 8192, estimateTokens: (text: string) => text.length };

    expect(
      (await service.promptContext({ sessionId, userInput: "beef", historicalTokenBudget: budget })).eventCandidates,
    ).toHaveLength(1);
    expect(service.invalidateSessionContext(sessionId)).toBe(0);

    expect(
      (await service.liveContext({ sessionId, historicalTokenBudget: { ...budget, maxTokens: 0 } })).eventCandidates,
    ).toEqual([]);
    expect(service.invalidateSessionContext(sessionId)).toBe(0);

    expect(
      (await service.liveContext({ sessionId, userInput: "beef", historicalTokenBudget: budget })).eventCandidates,
    ).toHaveLength(1);
    expect(service.invalidateSessionContext(sessionId)).toBe(1);
  });

  test("invalidating a session retires its frozen automatic-memory snapshot", async () => {
    const f = await fixture();
    const service = f.createService(f.createRuntime());
    const memory = await service.liveContext({
      sessionId: "session",
      historicalTokenBudget: { maxTokens: 2048, estimateTokens: (text) => text.length },
    });
    expect(service.invalidateSessionContext("session")).toBe(1);
    expect(
      (
        await service.liveContext({
          sessionId: "session",
          historicalTokenBudget: { maxTokens: 2048, estimateTokens: (text) => text.length },
        })
      ).eventCandidates,
    ).toEqual(memory.eventCandidates);
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

  test("scopes text-ranked routing scenarios by structured project provenance", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    runtime.recordToolRoutingMemory({ projectId: "project-a", sessionId: "a", requestId: "a", episode: scenario() });
    runtime.recordToolRoutingMemory({ projectId: "project-b", sessionId: "b", requestId: "b", episode: scenario() });
    await runtime.flush();
    expect(
      (await runtime.searchToolRouting("completed", "project-a", 8)).map((entry) => entry.memory.node.id),
    ).toHaveLength(1);
    expect(
      (await runtime.searchToolRouting("completed", "project-b", 8)).map((entry) => entry.memory.node.id),
    ).toHaveLength(1);
  });

  test("budgets the complete explicit-recall envelope and keeps smaller records when one record is oversized", async () => {
    const f = await fixture();
    const runtime = f.createRuntime();
    const args = { refs: ["memos:" + f.old.id] };
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
