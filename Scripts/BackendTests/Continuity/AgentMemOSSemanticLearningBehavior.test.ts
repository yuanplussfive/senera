import path from "node:path";
import { MemOS, type MemoryNode } from "@mem-os/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentMemOSSemanticLearningRuntime } from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticLearningRuntime.js";
import { AgentMemOSSemanticModelClient } from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticModelClient.js";
import {
  AgentMemOSTags,
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

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

async function fixture(maxAttempts = 2) {
  const root = createTemporaryDirectory("senera-memos-learning");
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: path.join(root, "ledger.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const ledger = new AgentBackgroundLearningRequestLedger(kernel);
  const repository = new InMemoryAgentMemorySourceRepository();
  const memos = new MemOS({
    dbPath: path.join(root, "memos.sqlite"),
    autoLinkThreshold: 0.75,
    experimental: { namespaces: true },
  });
  await memos.init();
  const previewSummary = (text: string): string =>
    new AgentModelTextPreviewer({ model: "test-model", tokenLimit: 50 }).preview(text).text;
  const identity = { user: "用户", assistant: "助手" };
  const learners: AgentMemOSSemanticLearningRuntime[] = [];
  const createLearner = (attemptBudget = maxAttempts, digestSummaryTokenLimit = 50) => {
    const learner = new AgentMemOSSemanticLearningRuntime({
      memos,
      namespace: "test",
      sourceRepository: repository,
      learningRequests: ledger,
      modelProvider: () => createModelProvider(),
      cacheScopeKey: "test",
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
        digestInputTokenBudget: 8192,
        digestSummaryTokenLimit,
      }),
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
      ...(input.candidates.length > 0 ? { candidate: input.candidates[0]!.ref } : {}),
    }));
  const summarize = vi
    .spyOn(AgentMemOSSemanticModelClient.prototype, "summarizePeriod")
    .mockImplementation(async (input) => ({
      summary: input.entries
        .map((entry) => entry.summary)
        .join(";")
        .trim(),
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
  return { memos, ledger, repository, createLearner, extract, summarize, nodes, record, identity };
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
  test("finishes a no-learning decision without creating semantic nodes or retrying after restart", async () => {
    const f = await fixture();
    f.extract.mockResolvedValueOnce({ action: "skip" });
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
    expect(
      f.summarize.mock.calls.flatMap(([input]) => input.entries.map((entry) => entry.summary)).join(" "),
    ).not.toMatch(/Ada|Nova/u);
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
    expect(f.summarize).toHaveBeenCalledTimes(2);
    const restarted = f.createLearner(2);
    restarted.start();
    await restarted.flush();
    expect(f.extract).toHaveBeenCalledTimes(1);
    expect(f.summarize).toHaveBeenCalledTimes(2);
    expect(await f.nodes()).toHaveLength(4);
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
    expect(knowledge[0]?.tags.filter((tag) => tag.startsWith("write:"))).toHaveLength(1);
    const fragments = await f.nodes(AgentMemOSTags.fragment);
    expect(fragments).toHaveLength(2);
    expect(fragments.find((node) => node.summary === "likes beef")?.tags).toContain("day:2026-10-01");
    expect(fragments.find((node) => node.summary === "likes beef and rice")?.tags).toContain("day:2026-10-03");
    expect(
      (await f.nodes(AgentMemOSTags.dailyDigest)).find((node) => node.tags.includes("day:2026-10-01"))?.summary,
    ).toBe("likes beef");
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
    expect((await f.nodes(AgentMemOSTags.dailyDigest)).map((node) => node.tags)).toEqual([
      expect.arrayContaining(["day:2026-09-01"]),
    ]);
    expect((await f.nodes(AgentMemOSTags.monthlyDigest)).map((node) => node.tags)).toEqual([
      expect.arrayContaining(["month:2026-09"]),
    ]);
    const last = f.repository.deleteSession("keep");
    await learner.deleteSources(last.episodeUris, last.sourceUris);
    await learner.flush();
    expect(await f.nodes()).toEqual([]);
  });

  test("uses bounded retry attempts and keeps native types without remapping", async () => {
    const f = await fixture(2);
    f.extract
      .mockRejectedValueOnce(new Error("temporary provider error"))
      .mockResolvedValue({ topic: "beef", summary: "a food entity", type: "entity", action: "new" });
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
    expect((await f.nodes(AgentMemOSTags.knowledge))[0]?.type).toBe("entity");
  });

  test("does not surface a failed background digest and retries after its contract changes", async () => {
    const f = await fixture(1);
    f.summarize.mockRejectedValueOnce(new AgentInvalidModelToolArgumentsError("MemOSPeriodDigest", ["summary"]));
    f.record("1", "2026-10-01T01:00:00Z");

    const initial = f.createLearner(1, 50);
    initial.start();
    await expect(initial.flush({ surfaceFailures: false })).resolves.toBeUndefined();
    expect(f.ledger.list({ stage: "day_digest_batch", status: "exhausted" })).not.toHaveLength(0);

    const recovered = f.createLearner(1, 85);
    recovered.start();
    await expect(recovered.flush({ surfaceFailures: false })).resolves.toBeUndefined();
    expect((await f.nodes(AgentMemOSTags.dailyDigest)).some((node) => node.tags.includes("day:2026-10-01"))).toBe(true);
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
    expect(projectAgentMemOSPeriod([AgentMemOSTags.monthlyDigest, "month:2026-10"])).toEqual({
      granularity: "month",
      start: "2026-09-30T16:00:00Z",
      end: "2026-10-31T16:00:00Z",
    });
  });
});
