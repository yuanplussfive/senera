import { AgentMemoryDiaryModel } from "../../../Source/AgentSystem/Continuity/AgentMemoryDiaryModel.js";
import { AgentMemoryDiaryStore } from "../../../Source/AgentSystem/Continuity/AgentMemoryDiaryStore.js";
import { AgentMemoryDiaryDefaults } from "../../../Source/AgentSystem/Continuity/AgentMemoryDiaryContract.js";
import path from "node:path";
import fs from "node:fs";
import { MemOS, type MemoryNode } from "@mem-os/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentMemOSSemanticLearningRuntime } from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticLearningRuntime.js";
import { AgentMemOSSemanticModelClient } from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticModelClient.js";
import {
  AgentMemOSSchemaVersion,
  AgentMemOSTags,
  createAgentMemOSPeriodMetadata,
  projectAgentMemOSPeriod,
} from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticTypes.js";
import { AgentBackgroundLearningRequestLedger } from "../../../Source/AgentSystem/Memory/AgentBackgroundLearningRequestLedger.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentInvalidModelToolArgumentsError } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelFailureMapper.js";
import {
  InMemoryAgentMemorySourceRepository,
  type AgentMemoryRecordedTurn,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import type { AgentStateCard } from "../../../Source/AgentSystem/StateCard/AgentStateCardTypes.js";
import { AgentModelTextPreviewer, AgentModelTokenEstimator } from "../../../Source/AgentSystem/Text/AgentTextBudget.js";
import { createModelProvider, createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { AgentMemoryLearningLedger } from "../../../Source/AgentSystem/Continuity/AgentMemoryLearningLedger.js";
import { AgentMemoryRetentionModel } from "../../../Source/AgentSystem/Continuity/AgentMemoryRetentionModel.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

async function fixture(maxAttempts = 2, scoreMemories = false) {
  const root = createTemporaryDirectory("senera-memos-learning");
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: path.join(root, "ledger.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const ledger = new AgentBackgroundLearningRequestLedger(kernel);
  const learningLedger = new AgentMemoryLearningLedger(kernel);
  const repository = new InMemoryAgentMemorySourceRepository();
  const memos = new MemOS({
    dbPath: path.join(root, "memos.sqlite"),
    autoLinkThreshold: 0.75,
    experimental: { namespaces: true },
  });
  await memos.init();
  const previewSummary = (text: string): string =>
    new AgentModelTextPreviewer({ model: "test-model", tokenLimit: 50 }).preview(text).text;
  const diaries = new AgentMemoryDiaryStore(path.join(root, "diary"));
  const identity = { user: "用户", assistant: "助手" };
  const learners: AgentMemOSSemanticLearningRuntime[] = [];
  const createLearner = (
    attemptBudget = maxAttempts,
    fragmentSummaryTokenLimit = 50,
    diaryInputTokenBudget = 16384,
  ) => {
    const learner = new AgentMemOSSemanticLearningRuntime({
      memos,
      namespace: "test",
      sourceRepository: repository,
      learningRequests: ledger,
      ...(scoreMemories ? { learningLedger } : {}),
      modelProvider: () => createModelProvider(),
      cacheScopeKey: "test",
      retentionPolicy: () => ({ FactDays: 7, ContextDays: 1 }),
      retentionInputTokenBudget: () => 8192,
      policy: () => ({
        enabled: true,
        maxAttempts: attemptBudget,
        retryBaseMs: 1,
        retryMaxDelayMs: 1,
        maxJobsPerDrain: 1,
      }),
      config: () => ({
        fragmentHistoryTurns: 6,
        knowledgeCandidateLimit: 8,
        assistantPreviewTokens: 256,
        fragmentSummaryTokenLimit,
      }),
      diary: {
        store: diaries,
        config: () => ({ ...AgentMemoryDiaryDefaults, InputTokenBudget: diaryInputTokenBudget }),
        now: () => "2026-10-27T00:00:00Z",
      },
      identityDisplayValues: () => identity,
    });
    learners.push(learner);
    return learner;
  };
  const extract = vi
    .spyOn(AgentMemOSSemanticModelClient.prototype, "extractFragment")
    .mockImplementation(async (input) => ({
      topic: input.user,
      summary: previewSummary(input.assistant),
      type: "preference",
      action: input.candidates.length > 0 ? "update" : "new",
      assessments: input.candidates
        .filter((candidate) => candidate.delivered)
        .map((candidate) => ({
          candidate: candidate.ref,
          usefulness: "unused",
          reason: "The fixture did not use this candidate.",
        })),
      ...(input.candidates.length > 0 ? { candidate: input.candidates[0]!.ref } : {}),
    }));
  const retention = vi.spyOn(AgentMemoryRetentionModel.prototype, "assess").mockResolvedValue({ days: 7 });
  const summarize = vi.spyOn(AgentMemoryDiaryModel.prototype, "generate").mockImplementation(async (input) => ({
    title: `${input.key} 的记忆`,
    body:
      input.period === "day"
        ? input.entries.map((entry) => JSON.stringify(entry)).join("\n\n")
        : input.entries.map((entry) => entry.text).join("\n\n"),
  }));
  cleanup.push(async () => {
    await Promise.allSettled(learners.map((learner) => learner.stop()));
    await memos.close();
    kernel.close();
    repository.close();
    removeDirectory(root);
  });
  const nodes = async (tag?: string): Promise<MemoryNode[]> =>
    (
      await memos.search({
        namespace: "test",
        tags: tag ? [tag] : undefined,
        limit: Math.max(memos.count, 1),
        includeHistorical: true,
      })
    ).map((result) => result.node);
  const record = (
    id: string,
    date: string,
    summary = "likes beef",
    sessionId = "session",
    startedAt = date,
    user = "beef",
  ): AgentMemoryRecordedTurn =>
    repository.recordCompletedTurn({
      sessionId,
      requestId: id,
      startedAt,
      completedAt: date,
      userEntry: { kind: "user.message", id: id + "-user", requestId: id, timestamp: startedAt, content: user },
      assistantEntry: {
        kind: "assistant.decision",
        id: id + "-assistant",
        requestId: id,
        timestamp: date,
        xml: summary,
      },
      terminal: { kind: "FinalAnswer", content: summary },
      executedTools: [],
      modelProvider: {
        id: "test",
        providerId: "test",
        kind: "test",
        endpoint: "openai-chat",
        baseUrl: "http://localhost",
        model: "test-model",
      },
      stateCard: card(),
    });
  const legacyPeriod = async (key: string, sourceUris: readonly string[] = []) => {
    const granularity = key.length === 7 ? "month" : "day";
    return memos.store(`Original diary for ${key}`, {
      namespace: "test",
      type: "context",
      source: "agent_inferred",
      summary: key,
      tags: [
        AgentMemOSTags.semantic,
        granularity === "day" ? AgentMemOSTags.dailyDigest : AgentMemOSTags.monthlyDigest,
      ],
      metadata: createAgentMemOSPeriodMetadata({
        granularity,
        periodKey: key,
        sourceUris,
        sessionIds: [],
        requestIds: [],
        operationKey: `legacy:${key}`,
      }),
    });
  };
  return {
    diaries,
    kernel,
    memos,
    ledger,
    learningLedger,
    repository,
    createLearner,
    extract,
    retention,
    summarize,
    nodes,
    record,
    identity,
    legacyPeriod,
  };
}

function card(): AgentStateCard {
  return {
    version: "senera.state_card=v3",
    turnIndex: 0,
    scene: { time: "2026-10-01", timeZone: "Asia/Shanghai" },
    topicRelation: "new_topic",
    prevRequests: [],
    lastTools: [],
    failedTools: [],
    artifacts: [],
    activeSkills: [],
    historyLayer: "fine",
    compactionDepth: 0,
    standaloneRequest: "beef",
  };
}

describe("MemOS semantic learning with real storage", () => {
  test.each([0, 7, 30])("assesses fact retention in a separate durable call: %i days", async (days) => {
    const f = await fixture();
    f.extract.mockResolvedValue({
      topic: "storage",
      summary: "Project uses SQLite",
      type: "fact",
      action: "new",
      assessments: [],
    });
    f.retention.mockResolvedValue({ days });
    const turn = f.record(
      "fact",
      "2026-10-27T01:00:00Z",
      "Project uses SQLite",
      "session",
      undefined,
      "Remember the storage decision",
    );
    const learner = f.createLearner();
    learner.start();
    learner.recordCompletedTurn(turn);
    await learner.flush();
    expect(f.extract).toHaveBeenCalledOnce();
    expect(f.retention).toHaveBeenCalledOnce();
    expect(f.retention.mock.calls[0]?.[0]).toMatchObject({
      fact: { summary: "Project uses SQLite" },
      user: "Remember the storage decision",
      defaultDays: 7,
    });
    expect((await f.nodes(AgentMemOSTags.knowledge))[0]?.metadata?.senera_retention).toEqual({
      days,
      confirmedAt: turn.episode.completedAt,
    });
    expect(f.ledger.list({ stage: "semantic_retention", status: "completed" })).toHaveLength(1);
    await learner.stop();
    const restarted = f.createLearner();
    restarted.start();
    await restarted.flush();
    expect(f.retention).toHaveBeenCalledOnce();
  });

  test.each([
    ["preference", 0],
    ["relationship", 0],
    ["context", 1],
  ] as const)("%s uses declared retention without an extra model call", async (type, days) => {
    const f = await fixture();
    f.extract.mockResolvedValue({
      topic: "work",
      summary: "Reusable source-backed memory",
      type,
      action: "new",
      assessments: [],
    });
    const turn = f.record(type, "2026-10-27T01:00:00Z");
    const learner = f.createLearner();
    learner.start();
    learner.recordCompletedTurn(turn);
    await learner.flush();
    expect(f.retention).not.toHaveBeenCalled();
    expect((await f.nodes(AgentMemOSTags.knowledge))[0]?.metadata?.senera_retention).toEqual({
      days,
      confirmedAt: turn.episode.completedAt,
    });
  });

  test("retention failure retries the second call without repeating extraction or creating permanent facts", async () => {
    const f = await fixture(1);
    f.extract.mockResolvedValue({
      topic: "storage",
      summary: "Project uses SQLite",
      type: "fact",
      action: "new",
      assessments: [],
    });
    f.retention.mockRejectedValueOnce(new Error("retention model unavailable"));
    f.record("retry-retention", "2026-10-27T01:00:00Z");
    const learner = f.createLearner();
    learner.start();
    await expect(learner.flush()).rejects.toThrow("background learning failed");
    expect(await f.nodes(AgentMemOSTags.knowledge)).toEqual([]);
    expect(f.ledger.list({ stage: "semantic_retention", status: "failed" })).toHaveLength(1);
    await expect(learner.stop()).rejects.toThrow();
    const restarted = f.createLearner(2);
    restarted.start();
    await restarted.flush();
    expect(f.extract).toHaveBeenCalledOnce();
    expect(f.retention).toHaveBeenCalledTimes(2);
    expect((await f.nodes(AgentMemOSTags.knowledge))[0]?.metadata?.senera_retention).toMatchObject({ days: 7 });
  });

  test("source erasure during the retention call cannot restore erased knowledge", async () => {
    const f = await fixture();
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    let release!: () => void;
    f.extract.mockResolvedValue({
      topic: "storage",
      summary: "Project uses SQLite",
      type: "fact",
      action: "new",
      assessments: [],
    });
    f.retention.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ days: 0 });
        }),
    );
    learner.recordCompletedTurn(f.record("erase-retention", "2026-10-27T01:00:00Z"));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const impact = f.repository.deleteSession("session");
    const erasure = learner.deleteSources(impact.episodeUris, impact.sourceUris);
    release();
    await erasure;
    await learner.flush();
    expect(await f.nodes(AgentMemOSTags.knowledge)).toEqual([]);
  });

  test("exports legacy period content before retiring it, without publishing an unfinished month", async () => {
    const f = await fixture();
    await f.legacyPeriod("2026-10-01", ["source:retained"]);
    await f.legacyPeriod("2026-09");
    await f.legacyPeriod("2026-10");
    const originalForget = f.memos.forget.bind(f.memos);
    const forget = vi.spyOn(f.memos, "forget");
    forget.mockImplementation(async (id) => {
      const node = await f.memos.retrieve(id);
      if (node?.tags.includes(AgentMemOSTags.dailyDigest) || node?.tags.includes(AgentMemOSTags.monthlyDigest)) {
        const exports = fs.readdirSync(path.join(f.diaries.root, "legacy"));
        expect(
          exports.some((name) =>
            fs.readFileSync(path.join(f.diaries.root, "legacy", name), "utf8").includes(node.content),
          ),
        ).toBe(true);
      }
      return originalForget(id);
    });
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    expect(f.diaries.read("2026-10-01")).toMatchObject({
      body: "Original diary for 2026-10-01",
      metadata: { sourceUris: ["source:retained"] },
    });
    expect(f.diaries.read("2026-09")?.body).toBe("Original diary for 2026-09");
    expect(f.diaries.read("2026-10")).toBeUndefined();
    expect(await f.nodes(AgentMemOSTags.dailyDigest)).toEqual([]);
    expect(await f.nodes(AgentMemOSTags.monthlyDigest)).toEqual([]);
    expect(fs.readdirSync(path.join(f.diaries.root, "legacy"))).toHaveLength(3);
    await learner.stop();
    const restarted = f.createLearner();
    restarted.start();
    await restarted.flush();
    expect(fs.readdirSync(path.join(f.diaries.root, "legacy"))).toHaveLength(3);
  });

  test("resumes interrupted legacy export idempotently", async () => {
    const f = await fixture(1);
    await f.legacyPeriod("2026-10-01");
    const forget = vi.spyOn(f.memos, "forget").mockRejectedValueOnce(new Error("interrupted retirement"));
    const learner = f.createLearner();
    learner.start();
    await expect(learner.flush()).rejects.toThrow("background learning failed");
    expect(f.diaries.read("2026-10-01")?.body).toBe("Original diary for 2026-10-01");
    await expect(learner.stop()).rejects.toThrow("background learning failed");
    forget.mockRestore();
    const restarted = f.createLearner();
    restarted.start();
    await restarted.flush();
    expect(await f.nodes(AgentMemOSTags.dailyDigest)).toEqual([]);
    expect(fs.readdirSync(path.join(f.diaries.root, "legacy"))).toHaveLength(1);
    expect(f.summarize).not.toHaveBeenCalled();
  });

  test("does not reimport legacy diaries derived from erased sources", async () => {
    const f = await fixture();
    const pending = f.ledger.begin({
      operationKey: "delete:retired",
      board: "semantic_memory",
      stage: "semantic_delete",
      attempt: 1,
      metadata: { episodeUris: [], sourceUris: ["source:erased"] },
    });
    pending.complete();
    await f.legacyPeriod("2026-10-01", ["source:erased"]);
    await f.legacyPeriod("2026-09");
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    expect(f.diaries.list()).toEqual([]);
    expect(fs.existsSync(path.join(f.diaries.root, "legacy"))).toBe(false);
    expect(await f.nodes(AgentMemOSTags.dailyDigest)).toEqual([]);
    expect(await f.nodes(AgentMemOSTags.monthlyDigest)).toEqual([]);
  });

  test("writes bounded daily Markdown with complete host provenance and no MemOS digest nodes", async () => {
    const f = await fixture();
    const turns = Array.from({ length: 24 }, (_, index) =>
      f.record(
        `diary-${index}`,
        `2026-10-01T01:${String(index).padStart(2, "0")}:00Z`,
        "Verified project detail. ".repeat(30),
      ),
    );
    const learner = f.createLearner(2, 50, 2000);
    learner.start();
    await learner.flush();
    const client = new AgentMemoryDiaryModel(createModelProvider(), "test");
    for (const [prompt] of f.summarize.mock.calls) expect(client.inputTokens(prompt)).toBeLessThanOrEqual(2000);
    expect(f.diaries.read("2026-10-01")?.metadata?.sourceUris).toEqual(
      expect.arrayContaining(turns.flatMap((turn) => turn.sources.map((source) => source.uri))),
    );
    expect(await f.nodes(AgentMemOSTags.dailyDigest)).toEqual([]);
    expect(await f.nodes(AgentMemOSTags.monthlyDigest)).toEqual([]);
    expect(f.diaries.read("2026-10")).toBeUndefined();
  });

  test("settles actual usefulness on skip without source repetition or SDK double weighting", async () => {
    const f = await fixture(2, true);
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    const user = "I prefer concise replies";
    f.learningLedger.task({ sessionId: "session", requestId: "origin" });
    f.extract.mockResolvedValueOnce({
      action: "new",
      type: "preference",
      topic: "Reply style",
      summary: "Prefers concise replies",
      assessments: [],
    });
    learner.recordCompletedTurn(f.record("origin", "2026-10-01T01:00:00Z", "Noted", "session", undefined, user));
    await learner.flush();
    const knowledge = (await f.nodes(AgentMemOSTags.knowledge))[0]!;
    expect(knowledge.metadata).toMatchObject({ senera_subject_id: "owner" });
    expect(f.learningLedger.quality(knowledge.id)).toMatchObject({ weight: 50, helpfulCount: 0 });
    const next = "What is my preferred reply style?";
    f.learningLedger.task({ sessionId: "session", requestId: "confirm", topicRelation: "new_topic" });
    f.learningLedger.stageDelivery(
      "session",
      "confirm",
      [{ id: knowledge.id, revision: "v1", summary: knowledge.summary }],
      "snapshot",
    );
    f.learningLedger.markDelivered("session", "confirm");
    f.extract.mockImplementationOnce(async (input) => ({
      action: "skip",
      assessments: [
        {
          candidate: input.candidates.find((candidate) => candidate.summary === knowledge.summary)!.ref,
          usefulness: "helpful",
          reason: "The answer uses the remembered reply style to answer the user's question.",
        },
      ],
    }));
    learner.recordCompletedTurn(
      f.record("confirm", "2026-10-01T02:00:00Z", "Concise response", "session", undefined, next),
    );
    await learner.flush();
    const quality = f.learningLedger.quality(knowledge.id);
    expect(quality.weight).toBeCloseTo(200 / 3);
    expect(quality.helpfulCount).toBe(1);
    expect(quality.recallCount).toBe(1);
    expect((await f.memos.retrieve(knowledge.id))?.trustScore).toBe(1);
    await learner.stop();
    const restarted = f.createLearner();
    restarted.start();
    await restarted.flush();
    expect(f.learningLedger.quality(knowledge.id)).toEqual(quality);
  });
  test("finishes a no-learning decision without creating semantic nodes or retrying after restart", async () => {
    const f = await fixture();
    f.extract.mockResolvedValueOnce({ action: "skip", assessments: [] });
    const first = f.createLearner();
    first.start();
    await first.flush();
    first.recordCompletedTurn(f.record("skip", "2026-10-01T01:00:00Z"));
    await first.flush();
    expect(await f.nodes()).toEqual([]);
    await first.stop();

    const restarted = f.createLearner();
    restarted.start();
    await restarted.flush();
    expect(f.extract).toHaveBeenCalledTimes(1);
  });

  test.each(["skip", "new"] as const)(
    "reassesses retired %s caches without rewriting committed knowledge",
    async (action) => {
      const f = await fixture(2, true);
      const learner = f.createLearner();
      learner.start();
      await learner.flush();
      f.learningLedger.task({ sessionId: "session", requestId: "origin" });
      learner.recordCompletedTurn(f.record("origin", "2026-10-01T01:00:00Z"));
      await learner.flush();
      const knowledge = (await f.nodes(AgentMemOSTags.knowledge))[0]!;
      f.learningLedger.task({ sessionId: "session", requestId: "recalled" });
      f.learningLedger.stageDelivery(
        "session",
        "recalled",
        [{ id: knowledge.id, revision: "delivered-v1", summary: "Original frozen preference" }],
        "snapshot",
      );
      f.learningLedger.markDelivered("session", "recalled");
      f.extract.mockImplementationOnce(async (input) => ({
        ...(action === "skip"
          ? { action }
          : { action, topic: "New topic", summary: "Another retained detail", type: "fact" }),
        assessments: input.candidates
          .filter((candidate) => candidate.delivered)
          .map((candidate) => ({
            candidate: candidate.ref,
            usefulness: "unused",
            reason: "Retired assessment incorrectly ignored its use.",
          })),
      }));
      const recalledTurn = f.record("recalled", "2026-10-01T02:00:00Z", "Response uses original preference");
      learner.recordCompletedTurn(recalledTurn);
      await learner.flush();
      await learner.stop();
      const before = (await f.nodes())
        .map((node) => ({ id: node.id, content: node.content }))
        .sort((a, b) => a.id.localeCompare(b.id));
      f.kernel.connection
        .prepare(
          `UPDATE memory_background_learning_requests SET metadata_json=json_remove(metadata_json,'$.assessmentVersion')
      WHERE entity_uri=? AND stage IN ('semantic_extract','semantic_fragment')`,
        )
        .run(recalledTurn.episode.uri);
      f.kernel.connection
        .prepare("UPDATE memory_utility_settlements SET contract_version=1 WHERE request_id='recalled'")
        .run();
      f.extract.mockImplementationOnce(async (input) => ({
        action: "new",
        topic: "Must never be duplicated",
        summary: "Reevaluation cannot write new knowledge",
        type: "fact",
        assessments: input.candidates
          .filter((candidate) => candidate.delivered)
          .map((candidate) => ({
            candidate: candidate.ref,
            usefulness: "helpful",
            reason: "The final response actually used the delivered preference.",
          })),
      }));
      const calls = f.extract.mock.calls.length;
      const restarted = f.createLearner();
      restarted.start();
      await restarted.flush();
      expect(f.extract.mock.calls.length).toBe(calls + 1);
      expect(
        f.extract.mock.calls.at(-1)![0].candidates.find((candidate) => candidate.delivered)?.deliveredVersions,
      ).toEqual([{ revision: "delivered-v1", summary: "Original frozen preference" }]);
      expect(f.learningLedger.quality(knowledge.id)).toMatchObject({
        helpfulCount: 1,
        unusedCount: 0,
        pendingCount: 0,
      });
      expect(f.learningLedger.quality(knowledge.id).weight).toBeCloseTo(200 / 3);
      expect(
        (await f.nodes())
          .map((node) => ({ id: node.id, content: node.content }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ).toEqual(before);
      await restarted.stop();
      const again = f.createLearner();
      again.start();
      await again.flush();
      expect(f.extract.mock.calls.length).toBe(calls + 1);
    },
  );

  test("projects profile names out of learning input and persisted semantic summaries", async () => {
    const f = await fixture();
    f.identity.user = "Ada";
    f.identity.assistant = "Nova";
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    learner.recordCompletedTurn(
      f.record(
        "identity",
        "2026-10-01T01:00:00Z",
        "Nova confirmed Ada prefers concise updates.",
        "session",
        "2026-10-01T00:59:00Z",
        "Ada prefers concise updates.",
      ),
    );
    await learner.flush();

    const input = f.extract.mock.calls[0]![0];
    expect(input.user).toBe("用户 prefers concise updates.");
    expect(input.assistant).toBe("我 confirmed 用户 prefers concise updates.");
    const summaries = (await f.nodes(AgentMemOSTags.knowledge)).map((node) => node.summary);
    expect(summaries).toEqual(["我 confirmed 用户 prefers concise updates."]);
    expect(summaries.join(" ")).not.toMatch(/Ada|Nova/u);
    expect(JSON.stringify(f.summarize.mock.calls)).not.toMatch(/Ada|Nova/u);
  });

  test("retains physical text and applies the configured assistant token budget to current and past turns", async () => {
    const f = await fixture();
    const text = "Detailed answer. ".repeat(600);
    const past = f.record("past", "2026-10-01T01:00:00Z", text);
    const current = f.record("current", "2026-10-01T02:00:00Z", text);
    expect(past.episode.assistantText).toBe(text);
    expect(current.episode.metadata.stateCard).toEqual(card());
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    const input = f.extract.mock.calls[1]![0];
    const estimator = new AgentModelTokenEstimator({ model: "test-model" });
    for (const assistant of [input.assistant, ...input.history.map((turn) => turn.assistant)]) {
      expect(estimator.estimate(assistant).tokenCount).toBeLessThanOrEqual(256);
      expect(assistant.endsWith("...")).toBe(true);
    }
    expect(input.user).toBe("beef");
  });

  test("resumes a persisted update by node ID when the target is absent from new search results", async () => {
    const f = await fixture(1);
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    learner.recordCompletedTurn(f.record("1", "2026-10-01T01:00:00Z", "likes beef"));
    await learner.flush();
    vi.spyOn(f.memos, "update").mockRejectedValueOnce(new Error("Interrupted knowledge write"));
    learner.recordCompletedTurn(f.record("2", "2026-10-01T02:00:00Z", "likes beef and rice"));
    await expect(learner.flush()).rejects.toThrow("background learning failed");
    await expect(learner.stop()).rejects.toThrow();
    const search = f.memos.search.bind(f.memos);
    vi.spyOn(f.memos, "search").mockImplementation(async (query) =>
      typeof query !== "string" && query.query && query.tags?.includes(AgentMemOSTags.knowledge) ? [] : search(query),
    );
    const restarted = f.createLearner(2);
    restarted.start();
    await restarted.flush();
    expect(f.extract).toHaveBeenCalledTimes(2);
    expect((await f.nodes(AgentMemOSTags.knowledge)).map((node) => node.summary)).toEqual(["likes beef and rice"]);
  });

  test("reuses unchanged fragment and digest commits across restart", async () => {
    const f = await fixture();
    f.record("1", "2026-10-01T01:00:00Z");
    const first = f.createLearner();
    first.start();
    await first.flush();
    await first.stop();
    expect(f.extract).toHaveBeenCalledTimes(1);
    expect(f.summarize).toHaveBeenCalledTimes(1);
    const restarted = f.createLearner(2);
    restarted.start();
    await restarted.flush();
    expect(f.extract).toHaveBeenCalledTimes(1);
    expect(f.summarize).toHaveBeenCalledTimes(1);
    expect(await f.nodes()).toHaveLength(2);
  });

  test("uses only completed past turns from the same session", async () => {
    const f = await fixture();
    f.record("past", "2026-10-01T01:00:00Z", "past response");
    f.record("other", "2026-10-01T02:00:00Z", "other session", "other");
    f.record("current", "2026-10-01T04:00:00Z", "current response", "session", "2026-10-01T03:00:00Z");
    f.record("future", "2026-10-01T05:00:00Z", "future response");
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    const current = f.extract.mock.calls.find(([input]) => input.assistant === "current response")?.[0];
    expect(current?.history.map((turn) => turn.assistant)).toEqual(["past response"]);
  });

  test("updates canonical knowledge but preserves day fragments and completion-day indexing", async () => {
    const f = await fixture();
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    learner.recordCompletedTurn(f.record("1", "2026-10-01T01:00:00Z", "likes beef"));
    await learner.flush();
    learner.recordCompletedTurn(
      f.record("2", "2026-10-02T16:01:00Z", "likes beef and rice", "session", "2026-10-02T15:59:00Z"),
    );
    await learner.flush();
    const knowledge = await f.nodes(AgentMemOSTags.knowledge);
    expect(knowledge).toHaveLength(1);
    expect(knowledge[0]?.summary).toBe("likes beef and rice");
    expect(knowledge[0]?.metadata).toMatchObject({
      senera_operation_key: expect.any(String),
      senera_source_session_ids: ["session"],
    });
    const fragments = await f.nodes(AgentMemOSTags.fragment);
    expect(fragments).toHaveLength(2);
    expect(fragments.find((node) => node.summary === "likes beef")?.metadata).toMatchObject({
      senera_source_session_ids: ["session"],
    });
    expect(fragments.find((node) => node.summary === "likes beef and rice")?.metadata).toMatchObject({
      senera_source_session_ids: ["session"],
    });
    expect(f.diaries.read("2026-10-01")?.body).toContain("likes beef");
  });

  test("records cross-session provenance without claiming one session owns a whole day", async () => {
    const f = await fixture();
    const a = f.record("alpha-turn", "2026-09-01T01:00:00Z", "likes beef", "alpha");
    const b = f.record("beta-turn", "2026-09-01T02:00:00Z", "likes rice", "beta");
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    for (const stage of ["daily_diary", "monthly_diary"]) {
      const record = f.ledger.list({ stage, status: "completed", limit: 1 })[0];
      expect(record).toMatchObject({
        sessionId: null,
        metadata: {
          episodeUris: expect.arrayContaining([a.episode.uri, b.episode.uri]),
          sourceUris: expect.arrayContaining([...a.sources, ...b.sources].map((source) => source.uri)),
        },
      });
    }
  });

  test("a failed ledger completion cannot reapply old knowledge after a later update", async () => {
    const f = await fixture(1);
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    const begin = f.ledger.begin.bind(f.ledger);
    let failOnce = true;
    vi.spyOn(f.ledger, "begin").mockImplementation((input) => {
      const handle = begin(input);
      if (input.stage !== "semantic_fragment") return handle;
      return {
        ...handle,
        complete: (value) => {
          if (failOnce) {
            failOnce = false;
            throw new Error("ledger commit failed");
          }
          handle.complete(value);
        },
      };
    });
    learner.recordCompletedTurn(f.record("1", "2026-10-01T01:00:00Z", "likes beef"));
    await expect(learner.flush()).rejects.toThrow("background learning failed");
    learner.recordCompletedTurn(f.record("2", "2026-10-01T02:00:00Z", "likes beef and rice"));
    await expect(learner.flush()).rejects.toThrow("background learning failed");
    await expect(learner.stop()).rejects.toThrow();
    const restarted = f.createLearner(2);
    restarted.start();
    await restarted.flush();
    expect(f.extract).toHaveBeenCalledTimes(2);
    expect((await f.nodes(AgentMemOSTags.knowledge))[0]?.summary).toBe("likes beef and rice");
  });

  test("deletes shared knowledge contributions, rebuilds retained turns, and removes empty periods", async () => {
    const f = await fixture();
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    learner.recordCompletedTurn(f.record("keep", "2026-09-01T01:00:00Z", "likes beef", "keep"));
    await learner.flush();
    learner.recordCompletedTurn(f.record("remove", "2026-10-01T01:00:00Z", "likes beef and rice", "remove"));
    await learner.flush();
    const impact = f.repository.deleteSession("remove");
    await learner.deleteSources(impact.episodeUris, impact.sourceUris);
    await learner.flush();
    expect((await f.nodes(AgentMemOSTags.knowledge)).map((node) => node.summary)).toEqual(["likes beef"]);
    expect(f.diaries.list({ period: "day" }).map((entry) => entry.key)).toEqual(["2026-09-01"]);
    expect(f.diaries.list({ period: "month" }).map((entry) => entry.key)).toEqual(["2026-09"]);
    const last = f.repository.deleteSession("keep");
    await learner.deleteSources(last.episodeUris, last.sourceUris);
    await learner.flush();
    expect(await f.nodes()).toEqual([]);
  });

  test("uses bounded retry attempts and keeps native types without remapping", async () => {
    const f = await fixture(2);
    f.extract
      .mockRejectedValueOnce(new Error("temporary provider error"))
      .mockResolvedValue({ topic: "beef", summary: "a food fact", type: "fact", action: "new", assessments: [] });
    f.record("1", "2026-10-01T01:00:00Z");
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    expect(f.extract).toHaveBeenCalledTimes(2);
    expect(
      f.ledger
        .list({ stage: "semantic_extract" })
        .map((row) => row.attempt)
        .sort(),
    ).toEqual([1, 2]);
    expect((await f.nodes(AgentMemOSTags.knowledge))[0]?.type).toBe("fact");
  });

  test("startup preserves conversation coverage and learning failures in daily and monthly diaries", async () => {
    const f = await fixture(1);
    f.record("failed", "2026-09-01T01:00:00Z");
    f.record("same-month", "2026-09-02T01:00:00Z");
    f.record("independent", "2026-10-01T01:00:00Z");
    f.extract.mockRejectedValueOnce(new Error("one extraction failed"));
    const learner = f.createLearner();
    learner.start();
    await expect(learner.flush()).rejects.toThrow("background learning failed");
    expect(f.diaries.read("2026-09-01")?.body).toContain('"learning":"exhausted"');
    expect(f.diaries.read("2026-09-02")).toBeDefined();
    expect(f.diaries.read("2026-10-01")).toBeDefined();
    expect(f.diaries.read("2026-09")).toBeDefined();
    await expect(learner.stop()).rejects.toThrow();
    const restarted = f.createLearner(2);
    restarted.start();
    await restarted.flush();
    expect(f.diaries.read("2026-09-01")).toBeDefined();
    expect(f.diaries.read("2026-09")).toBeDefined();
  });

  test("deletion commits independently of downstream diary generation", async () => {
    const f = await fixture(1);
    f.record("keep", "2026-10-01T01:00:00Z", "keep this fact", "keep");
    f.record("remove", "2026-10-01T02:00:00Z", "remove this fact", "remove");
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    f.summarize.mockRejectedValue(new Error("diary provider unavailable"));
    const impact = f.repository.deleteSession("remove");
    await expect(learner.deleteSources(impact.episodeUris, impact.sourceUris)).resolves.toBeUndefined();
    await learner.flush({ surfaceFailures: false });
    expect(f.ledger.list({ stage: "semantic_delete" }).map((entry) => entry.status)).toEqual(["completed"]);
    expect(f.ledger.list({ stage: "daily_diary", status: "exhausted" })).toHaveLength(1);
    expect((await f.nodes(AgentMemOSTags.knowledge)).map((node) => node.summary)).toEqual(["keep this fact"]);
    expect(f.diaries.read("2026-10-01")).toBeUndefined();
  });

  test("persists a deletion request before waiting for in-flight extraction", async () => {
    const f = await fixture();
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    let release!: () => void;
    f.extract.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ action: "skip", assessments: [] });
        }),
    );
    learner.recordCompletedTurn(f.record("pending", "2026-10-01T01:00:00Z"));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const impact = f.repository.deleteSession("session");
    const pending = learner.deleteSources(impact.episodeUris, impact.sourceUris);
    const persisted = f.ledger.list({ stage: "semantic_delete" });
    release();
    await pending;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.status).toBe("started");
    await learner.flush();
    expect(f.diaries.list()).toEqual([]);
  });

  test("diary generation and extraction share the configured model concurrency", async () => {
    const f = await fixture();
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    let release!: () => void;
    f.summarize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ title: "已完成", body: "原始记忆已经整理。" });
        }),
    );
    learner.recordCompletedTurn(f.record("closed-day", "2026-10-01T01:00:00Z"));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    learner.recordCompletedTurn(f.record("today", "2026-10-27T01:00:00Z"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const callsWhileDiaryPending = f.extract.mock.calls.length;
    release();
    await learner.flush();
    expect(callsWhileDiaryPending).toBe(1);
    expect(f.extract).toHaveBeenCalledTimes(2);
  });

  test("does not surface a failed background diary and retries when its input contract changes", async () => {
    const f = await fixture(1);
    f.summarize.mockRejectedValueOnce(new AgentInvalidModelToolArgumentsError("MemoryDiary", ["body"]));
    f.record("1", "2026-10-01T01:00:00Z");
    const initial = f.createLearner(1, 50);
    initial.start();
    await expect(initial.flush({ surfaceFailures: false })).resolves.toBeUndefined();
    expect(f.ledger.list({ stage: "daily_diary", status: "exhausted" })).not.toHaveLength(0);
    await expect(initial.stop()).rejects.toThrow("background learning failed");
    const recovered = f.createLearner(1, 50, 12000);
    recovered.start();
    await expect(recovered.flush({ surfaceFailures: false })).resolves.toBeUndefined();
    expect(f.diaries.read("2026-10-01")).toBeDefined();
  });

  test("resumes a partially failed deletion after restart without resurrecting deleted turns", async () => {
    const f = await fixture(1);
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    learner.recordCompletedTurn(f.record("1", "2026-10-01T01:00:00Z"));
    await learner.flush();
    const impact = f.repository.deleteSession("session");
    const forget = vi.spyOn(f.memos, "forget").mockRejectedValueOnce(new Error("temporary persistence error"));
    await expect(learner.deleteSources(impact.episodeUris, impact.sourceUris)).rejects.toThrow("persistence error");
    await expect(learner.stop()).rejects.toThrow();
    forget.mockRestore();
    const restarted = f.createLearner(2);
    restarted.start();
    await restarted.flush();
    expect(await f.nodes()).toEqual([]);
    expect(f.extract).toHaveBeenCalledTimes(1);
  });

  test("explicit learning intents reach the model without full tool evidence", async () => {
    const f = await fixture();
    const learner = f.createLearner();
    learner.start();
    await learner.flush();
    const turn = f.record("1", "2026-10-01T01:00:00Z");
    turn.sources.push({
      ...turn.sources[0]!,
      metadata: { evidence: { kind: "continuity_write", facts: [{ name: "summary", value: "likes rice" }] } },
    });
    learner.recordCompletedTurn(turn);
    await learner.flush();
    expect(f.extract.mock.calls[0]?.[0].memoryIntents).toEqual(["likes rice"]);
    expect(f.extract.mock.calls[0]?.[0]).not.toHaveProperty("sources");
  });

  test("month boundaries use the real Shanghai calendar", () => {
    expect(
      projectAgentMemOSPeriod({
        id: "month",
        content: "",
        summary: "",
        type: "context",
        source: "agent_inferred",
        importance: 0,
        trustScore: 0,
        tags: [AgentMemOSTags.semantic, AgentMemOSTags.monthlyDigest],
        namespace: "test",
        metadata: {
          senera_schema: AgentMemOSSchemaVersion,
          senera_domain: "semantic",
          senera_scope: "period",
          senera_period_granularity: "month",
          senera_period_key: "2026-10",
          senera_period_start: "2026-10-01T00:00:00+08:00",
          senera_period_end: "2026-11-01T00:00:00+08:00",
        },
        createdAt: 0,
        updatedAt: 0,
        accessCount: 0,
        validFrom: null,
        validTo: null,
      } as unknown as MemoryNode),
    ).toEqual({
      granularity: "month",
      start: "2026-10-01T00:00:00+08:00",
      end: "2026-11-01T00:00:00+08:00",
    });
  });
});
