import path from "node:path";
import { MemOS, type MemoryNode } from "@mem-os/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentMemoryRelevanceAssessment } from "../../../Source/AgentSystem/Continuity/AgentMemoryRelevanceModel.js";
import { AgentContinuityMemoryService } from "../../../Source/AgentSystem/Continuity/AgentContinuityMemoryService.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import { AgentMemoryLearningLedger } from "../../../Source/AgentSystem/Continuity/AgentMemoryLearningLedger.js";
import {
  AgentMemOSSchemaVersion,
  AgentMemOSTags,
} from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticTypes.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import {
  renderAgentLiveStateWire,
  renderAgentContinuityPromptWire,
  renderAgentDynamicMemoryWire,
} from "../../../Source/AgentSystem/Prompt/AgentPromptContextWireRenderer.js";
import { EmptyAgentWorkflowPromptContext } from "../../../Source/AgentSystem/Prompt/AgentWorkflowPromptContext.js";
import { createAgentPiPromptCacheOptions } from "../../../Source/AgentSystem/Pi/AgentPiPromptCache.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const budget = { maxTokens: 16384, estimateTokens: (text: string) => text.length };
const input = {
  sessionId: "session",
  requestId: "first",
  userInput: "Build the current project",
  historicalTokenBudget: budget,
};

function reinforce(ledger: AgentMemoryLearningLedger, nodeId: string): void {
  const requestId = `helpful:${nodeId}`;
  ledger.task({ sessionId: "prior-task", requestId });
  ledger.stageDelivery("prior-task", requestId, [{ id: nodeId, revision: "v1", summary: "Used memory" }], "snapshot");
  ledger.markDelivered("prior-task", requestId);
  ledger.completeRecall("prior-task", requestId, "2026-10-28T00:00:00Z");
  ledger.settleUtility("prior-task", requestId, nodeId, "helpful", "Used in a completed task.");
}

async function fixture(diaryIndex?: () => string) {
  const directory = createTemporaryDirectory("senera-memory-boundaries");
  const kernel = new AgentSqliteDatabaseKernel({
    databasePath: path.join(directory, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  const memos = new MemOS({ dbPath: path.join(directory, "memos.sqlite"), experimental: { namespaces: true } });
  await memos.init();
  const ledger = new AgentMemoryLearningLedger(kernel);
  const store = new AgentContinuitySqliteStore(kernel);
  const nodes: MemoryNode[] = [];
  const add = async (
    summary: string,
    type: "fact" | "preference" | "context" | "relationship",
    subjectId = "owner",
    taskId?: string,
    occurredAt?: string,
  ) => {
    const { node } = await memos.store(summary, {
      summary,
      type,
      namespace: "test",
      ...(occurredAt ? { validFrom: Date.parse(occurredAt) } : {}),
      tags: [AgentMemOSTags.semantic, AgentMemOSTags.knowledge],
      metadata: {
        senera_schema: AgentMemOSSchemaVersion,
        senera_domain: "semantic",
        senera_scope: type === "context" ? "session" : "workspace",
        senera_operation_key: summary,
        senera_episode_uri: "episode",
        senera_source_uris: ["source"],
        senera_source_session_ids: ["session"],
        senera_source_request_ids: ["request"],
        senera_subject_id: subjectId,
        ...(taskId ? { senera_task_id: taskId } : {}),
      },
    });
    nodes.push(node);
    return node;
  };
  const project = (node: MemoryNode) => ({ memory: { node, score: 1, scores: {} }, quality: ledger.quality(node.id) });
  const port = {
    search: async () => nodes.filter((node) => node.type === "fact").map(project),
    searchRecent: async () => nodes.map(project),
    taskMemory: async (taskId: string) => nodes.filter((node) => node.metadata?.senera_task_id === taskId).map(project),
  };
  const assessRelevance = vi.fn<AgentMemoryRelevanceAssessment>(async ({ candidates }) => candidates);
  const service = new AgentContinuityMemoryService({
    store,
    learningLedger: ledger,
    memos: port,
    assessRelevance,
    recallConfig: () => ({ PromptBudget: { MaxTokens: 16384 } }),
    diaryIndex,
  });
  cleanup.push(async () => {
    await memos.close();
    kernel.close();
    removeDirectory(directory);
  });
  return { ledger, store, service, add, port, nodes, assessRelevance };
}

describe("Source-backed long-term and task context boundaries", () => {
  test("query preferences keep assessed scores and reinforcement never rewrites the frozen wire", async () => {
    const f = await fixture();
    const preference = await f.add("Prefers fish", "preference");
    vi.spyOn(f.port, "search").mockResolvedValue([
      {
        memory: { node: preference, score: 0.4, scores: { keyword: 0.7, semantic: 0.9 } },
        quality: f.ledger.quality(preference.id),
      },
    ]);
    f.assessRelevance.mockImplementation(async ({ candidates }) =>
      candidates.map((candidate) => ({
        ...candidate,
        score: 0.45,
        scores: { ...candidate.scores, relevance: 0.9 },
        matchedBy: [...candidate.matchedBy, "relevance_assessment"],
      })),
    );
    const first = await f.service.liveContext(input);
    expect(first.eventCandidates).toHaveLength(1);
    expect(first.eventCandidates[0]).toMatchObject({
      id: preference.id,
      score: 0.45,
      scores: { keyword: 0.7, semantic: 0.9, relevance: 0.9 },
    });
    expect(first.eventCandidates[0]?.matchedBy).not.toContain("global_preference");
    expect(first.retrieval?.background).toMatchObject({
      source: "query",
      queryCandidates: 1,
      keywordMatches: 1,
      semanticMatches: 1,
    });
    f.service.acknowledgeMemoryDelivery(input.sessionId, input.requestId);
    f.ledger.completeRecall(input.sessionId, input.requestId, "2026-10-28T00:00:00Z");
    f.ledger.settleUtility(input.sessionId, input.requestId, preference.id, "helpful", "Used in the response.");
    const next = await f.service.liveContext({ ...input, requestId: "next", topicRelation: "continue" });
    expect(renderAgentContinuityPromptWire(next, budget)).toEqual(renderAgentContinuityPromptWire(first, budget));
    expect(next.currentQuality?.[preference.id]?.weight).toBeCloseTo(200 / 3);
    expect(next.retrieval?.background.source).toBe("frozen");
    expect(f.assessRelevance).toHaveBeenCalledOnce();
  });

  test("freezes diary Markdown with an empty background until compaction or a new conversation", async () => {
    let index = "# Memory index\n\n- [Upload fix](2026/10/26/diary.md) — 2026-10-26";
    const readIndex = vi.fn(() => index);
    const f = await fixture(readIndex);
    const preview = await f.service.promptContext(input);
    expect(preview.diaryIndex).toBe(index);
    expect(f.store.readMemorySnapshot(input.sessionId)).toBeUndefined();
    const first = await f.service.liveContext(input);
    const wire = renderAgentContinuityPromptWire(first, budget);
    expect(wire.text).toContain(index);
    expect(first.selection.usedTokens).toBe(wire.tokenCount);
    expect(f.store.readMemorySnapshot(input.sessionId)).toEqual({ entries: [], diaryIndex: index });
    index = "# Memory index\n\n- [New day](2026/10/27/diary.md) — 2026-10-27";
    readIndex.mockClear();
    const continued = await f.service.liveContext({ ...input, requestId: "next-day", topicRelation: "continue" });
    expect(renderAgentContinuityPromptWire(continued, budget)).toEqual(wire);
    expect(readIndex).not.toHaveBeenCalled();
    expect(
      renderAgentLiveStateWire({ continuity: continued, workflow: EmptyAgentWorkflowPromptContext }, budget).text,
    ).not.toContain("# Memory index");
    const newSession = await f.service.liveContext({ ...input, sessionId: "new-session" });
    expect(newSession.diaryIndex).toBe(index);
    f.service.invalidateSessionContext(input.sessionId, "compaction");
    const refreshed = await f.service.liveContext({ ...input, requestId: "compacted" });
    expect(refreshed.diaryIndex).toBe(index);
    expect(renderAgentContinuityPromptWire(refreshed, budget).sourceRevision).not.toBe(wire.sourceRevision);
  });

  test("keeps the frozen diary whole and includes it in the complete memory budget", async () => {
    const index = "# Memory index\n\n- [Yesterday](2026/10/26/diary.md) — 2026-10-26";
    const f = await fixture(() => index);
    await f.add("Large fact ".repeat(500), "fact");
    const first = await f.service.liveContext({ ...input, historicalTokenBudget: { ...budget, maxTokens: 1700 } });
    expect(first.diaryIndex).toBe(index);
    expect(first.eventCandidates).toEqual([]);
    expect(first.selection.usedTokens).toBe(renderAgentContinuityPromptWire(first, budget).tokenCount);
    expect(first.selection.usedTokens).toBeLessThanOrEqual(1700);
    const smaller = await f.service.liveContext({
      ...input,
      requestId: "tiny",
      historicalTokenBudget: { ...budget, maxTokens: 10 },
    });
    expect(smaller.diaryIndex).toBe("");
    expect(smaller.selection.usedTokens).toBe(0);
    expect(f.store.readMemorySnapshot(input.sessionId)?.diaryIndex).toBe(index);
  });

  test("rejects irrelevant high-quality facts while considering global preferences independently", async () => {
    const f = await fixture();
    const unrelated = await f.add("Unrelated historical detail", "fact");
    reinforce(f.ledger, unrelated.id);
    const preference = await f.add("Prefers concise replies", "preference");
    f.assessRelevance.mockResolvedValue([]);
    const first = await f.service.liveContext(input);
    expect(first.eventCandidates.map((record) => record.id)).toEqual([preference.id]);
    expect(first.eventCandidates[0]?.matchedBy).toContain("global_preference");
    expect(first.diagnostics).toMatchObject({ irrelevant: 0, snapshotReused: false });
    expect(first.selection.events).toEqual({ available: 1, matched: 1, selected: 1 });
    expect(first.selection.related).toEqual({ available: 1, matched: 0, selected: 0 });
    expect(f.assessRelevance.mock.calls[0]![0].candidates.map((record) => record.id)).toEqual([unrelated.id]);
    await f.service.liveContext({ ...input, requestId: "next", topicRelation: "continue" });
    expect(f.assessRelevance).toHaveBeenCalledTimes(2);
  });

  test("freezes an empty background and its cache scope until a new session or compaction", async () => {
    const f = await fixture();
    const first = await f.service.liveContext(input);
    const system = (memory: typeof first) =>
      `Host instructions\n${renderAgentContinuityPromptWire(memory, budget).text}`;
    const cache = (memory: typeof first) =>
      createAgentPiPromptCacheOptions({
        phase: "native-conversation",
        sessionId: input.sessionId,
        model: { provider: "test", api: "openai-responses", model: "test-model" },
        stablePrefix: { systemPrompt: system(memory) },
      });
    expect(first.eventCandidates).toEqual([]);
    expect(f.store.readMemorySnapshot(input.sessionId)).toEqual({ entries: [], diaryIndex: "" });
    const preference = await f.add("User likes eating fish", "preference");
    const search = vi.spyOn(f.port, "search");
    const recent = vi.spyOn(f.port, "searchRecent");
    for (const topicRelation of ["continue", "new_topic"] as const) {
      const next = await f.service.liveContext({ ...input, requestId: topicRelation, topicRelation });
      expect(next.eventCandidates).toEqual([]);
      expect(next.snapshotGeneration).toBe(first.snapshotGeneration);
      expect(next.diagnostics?.snapshotReused).toBe(true);
      expect(system(next)).toBe(system(first));
      expect(cache(next)).toEqual(cache(first));
    }
    expect(search).toHaveBeenCalledTimes(2);
    expect(recent).not.toHaveBeenCalled();
    const newSession = await f.service.liveContext({ ...input, sessionId: "new-session" });
    expect(newSession.eventCandidates.map((record) => record.id)).toEqual([preference.id]);
    f.service.invalidateSessionContext(input.sessionId, "native-compaction");
    const refreshed = await f.service.liveContext({ ...input, requestId: "compacted" });
    expect(refreshed.eventCandidates.map((record) => record.id)).toEqual([preference.id]);
    expect(refreshed.snapshotGeneration).toBe(1);
    expect(cache(refreshed).scope).not.toBe(cache(first).scope);
    f.service.invalidateSessionContext(input.sessionId, "native-compaction");
    expect(f.store.snapshotGeneration(input.sessionId)).toBe(1);
  });

  test("keeps task learning live while an empty long-term background stays frozen", async () => {
    const f = await fixture();
    await f.service.liveContext(input);
    const task = f.ledger.task(input);
    await f.add("User likes eating fish", "preference");
    const context = await f.add(
      "Upload failure traced to the Android activity lifecycle",
      "context",
      "owner",
      task.taskId,
    );
    const next = await f.service.liveContext({ ...input, requestId: "progress", topicRelation: "continue" });
    expect(next.eventCandidates).toEqual([]);
    expect(next.taskCandidates?.map((record) => record.id)).toEqual([context.id]);
    const live = renderAgentLiveStateWire({ continuity: next, workflow: EmptyAgentWorkflowPromptContext }, budget).text;
    expect(live).toContain(context.summary);
    expect(live).not.toContain("User likes eating fish");
    expect(renderAgentContinuityPromptWire(next, budget).text).toBe("");
  });

  test("does not commit a preview but freezes a successfully rejected background", async () => {
    const f = await fixture();
    await f.service.promptContext(input);
    expect(f.store.readMemorySnapshot(input.sessionId)).toBeUndefined();
    const fact = await f.add("Unrelated project detail", "fact");
    f.assessRelevance.mockResolvedValue([]);
    const rejected = await f.service.liveContext(input);
    expect(rejected.retrieval?.related?.status).toBe("completed");
    expect(rejected.selection.related).toEqual({ available: 1, matched: 0, selected: 0 });
    expect(f.store.readMemorySnapshot(input.sessionId)).toEqual({ entries: [], diaryIndex: "" });
    f.assessRelevance.mockImplementation(async ({ candidates }) => candidates);
    const next = await f.service.liveContext({ ...input, requestId: "different-question" });
    expect(next.eventCandidates).toEqual([]);
    expect(next.relatedCandidates?.map((entry) => entry.id)).toEqual([fact.id]);
    expect(f.assessRelevance).toHaveBeenCalledTimes(2);
  });

  test("does not mistake a failed recall for a successful empty background", async () => {
    const f = await fixture();
    vi.spyOn(f.port, "search").mockRejectedValueOnce(new Error("recall unavailable"));
    expect((await f.service.liveContext(input)).eventCandidates).toEqual([]);
    expect(f.store.readMemorySnapshot(input.sessionId)).toBeUndefined();
    const preference = await f.add("User likes eating fish", "preference");
    const next = await f.service.liveContext({ ...input, requestId: "recovered" });
    expect(next.eventCandidates.map((record) => record.id)).toEqual([preference.id]);
  });

  test("does not commit an empty snapshot when cancellation arrives during recall", async () => {
    const f = await fixture();
    const controller = new AbortController();
    vi.spyOn(f.port, "searchRecent").mockImplementationOnce(async () => {
      controller.abort(new Error("cancelled during recall"));
      return [];
    });
    await expect(f.service.liveContext({ ...input, signal: controller.signal })).rejects.toThrow(
      "cancelled during recall",
    );
    expect(f.store.readMemorySnapshot(input.sessionId)).toBeUndefined();
    const preference = await f.add("User likes eating fish", "preference");
    const next = await f.service.liveContext({ ...input, requestId: "not-cancelled" });
    expect(next.eventCandidates.map((record) => record.id)).toEqual([preference.id]);
  });

  test("retries failed dynamic assessment while preserving the independently frozen preferences", async () => {
    const f = await fixture();
    const preference = await f.add("Use concise replies", "preference");
    await f.add("Project fact awaiting relevance assessment", "fact");
    f.assessRelevance.mockRejectedValueOnce(new Error("learning model unavailable"));
    const first = await f.service.liveContext(input);
    expect(first.retrieval?.related?.status).toBe("unavailable");
    expect(first.eventCandidates.map((record) => record.id)).toEqual([preference.id]);
    expect(f.store.readMemorySnapshot(input.sessionId)?.entries.map((entry) => entry.id)).toEqual([preference.id]);
    const next = await f.service.liveContext({ ...input, requestId: "retry" });
    expect(next.eventCandidates).toHaveLength(1);
    expect(next.relatedCandidates).toHaveLength(1);
    expect(next.retrieval?.related?.status).toBe("completed");
    expect(renderAgentContinuityPromptWire(next, budget)).toEqual(renderAgentContinuityPromptWire(first, budget));
  });

  test("keeps a detailed high-priority finding under a smaller complete dynamic-wire budget", async () => {
    const f = await fixture();
    const critical = await f.add("Critical verified finding. ".repeat(30), "fact");
    await f.add("Short incidental note", "fact");
    f.assessRelevance.mockImplementation(async ({ candidates }) =>
      candidates.map((record) => ({
        ...record,
        score: record.id === critical.id ? 0.9 : 0.6,
        scores: { relevance: record.id === critical.id ? 0.9 : 0.6 },
      })),
    );
    const full = await f.service.liveContext(input);
    const tokens = renderAgentDynamicMemoryWire(
      { ...full, relatedCandidates: full.relatedCandidates?.filter((record) => record.id === critical.id) },
      budget,
    ).tokenCount;
    const smaller = await f.service.liveContext({
      ...input,
      requestId: "smaller-model",
      topicRelation: "continue",
      historicalTokenBudget: { ...budget, maxTokens: tokens },
    });
    expect(smaller.relatedCandidates?.map((record) => record.id)).toEqual([critical.id]);
    expect(smaller.relatedCandidates?.[0]?.score).toBe(0.9);
    expect(smaller.selection.related).toEqual({ available: 2, matched: 2, selected: 1 });
    expect(smaller.selection.usedTokens).toBe(tokens);
    expect(f.store.readMemorySnapshot(input.sessionId)?.entries).toHaveLength(0);
    expect(f.assessRelevance).toHaveBeenCalledTimes(2);
  });

  test("uses task relevance, recency and weight without admitting another task's state", async () => {
    const f = await fixture();
    const task = f.ledger.task(input);
    const old = await f.add("Earlier decisive finding", "context", "owner", task.taskId, "2026-10-26T01:00:00Z");
    const newest = await f.add("Latest progress", "context", "owner", task.taskId, "2026-10-27T01:00:00Z");
    await f.add("Other task state", "context", "owner", "another-task");
    const first = await f.service.liveContext(input);
    expect(first.taskCandidates?.map((record) => record.id)).toEqual([newest.id, old.id]);
    const read = f.port.taskMemory;
    reinforce(f.ledger, old.id);
    f.port.taskMemory = async (taskId) =>
      (await read(taskId)).map((record) => ({
        ...record,
        memory: { ...record.memory, score: record.memory.node.id === old.id ? 1 : 0 },
      }));
    const next = await f.service.liveContext({ ...input, requestId: "continued", topicRelation: "continue" });
    expect(next.taskCandidates?.map((record) => record.id)).toEqual([old.id, newest.id]);
    expect(next.taskCandidates?.[0]?.scores).toMatchObject({ relevance: 1, recency: 0 });
    expect(next.taskCandidates?.[1]?.scores).toMatchObject({ relevance: 0, recency: 1 });
  });

  test("includes unrelated owner preferences, freezes scores, and keeps task state out of the system background", async () => {
    const f = await fixture();
    const preference = await f.add("Prefers concise replies", "preference");
    await f.add("Foreign member prefers long replies", "preference", "another-member");
    const fact = await f.add("Project uses SQLite", "fact");
    const task = f.ledger.task(input);
    const context = await f.add("Current build awaits approval", "context", "owner", task.taskId);
    const preview = await f.service.promptContext(input);
    expect(f.store.readMemorySnapshot(input.sessionId)).toBeUndefined();
    expect(f.ledger.quality(preference.id).recallCount).toBe(0);
    const first = await f.service.liveContext(input);
    expect(first.eventCandidates.map((entry) => entry.id)).toEqual([preference.id]);
    expect(first.relatedCandidates?.map((entry) => entry.id)).toEqual([fact.id]);
    expect(first.taskCandidates?.map((entry) => entry.id)).toEqual([context.id]);
    const wire = renderAgentContinuityPromptWire(first, budget).text;
    const live = renderAgentLiveStateWire(
      { continuity: first, workflow: EmptyAgentWorkflowPromptContext },
      budget,
    ).text;
    expect(wire).toContain(preference.summary);
    expect(wire).not.toContain(context.summary);
    expect(wire).not.toContain(fact.summary);
    expect(live).toContain(context.summary);
    expect(live).toContain(fact.summary);
    expect(live).not.toContain(preference.summary);
    expect(preview.eventCandidates).toEqual(first.eventCandidates);
    f.service.acknowledgeMemoryDelivery(input.sessionId, input.requestId);
    expect(f.ledger.quality(preference.id).recallCount).toBe(1);
    f.ledger.completeRecall(input.sessionId, input.requestId, "2026-10-28T00:00:00Z");
    f.ledger.settleUtility(input.sessionId, input.requestId, preference.id, "helpful", "Used in the response.");
    const continued = await f.service.liveContext({ ...input, requestId: "continued", topicRelation: "continue" });
    expect(renderAgentContinuityPromptWire(continued, budget).text).toBe(wire);
    f.service.invalidateSessionContext(input.sessionId, "native-compaction-id");
    const refreshed = await f.service.liveContext({ ...input, requestId: "continued", topicRelation: "continue" });
    expect(refreshed.eventCandidates.find((entry) => entry.id === preference.id)?.quality?.weight).toBeCloseTo(200 / 3);
    const generation = refreshed.snapshotGeneration;
    f.service.invalidateSessionContext(input.sessionId, "native-compaction-id");
    expect(f.store.snapshotGeneration(input.sessionId)).toBe(generation);
    const nextTask = await f.service.liveContext({ ...input, requestId: "new-task", topicRelation: "new_topic" });
    expect(nextTask.taskCandidates).toEqual([]);
  });

  test("cannot resurrect a deleted source through an in-flight snapshot write", async () => {
    const f = await fixture();
    await f.add("Memory from a deleted source", "preference");
    let reached!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = f.port.searchRecent;
    let first = true;
    f.port.searchRecent = async () => {
      const result = await read();
      if (first) {
        first = false;
        reached();
        await paused;
      }
      return result;
    };
    const pending = f.service.liveContext(input);
    await started;
    f.nodes.splice(0);
    f.service.deleteSources({ sessionId: input.sessionId, scope: "session", episodeUris: [], sourceUris: ["source"] });
    release();
    expect((await pending).eventCandidates).toEqual([]);
    expect(f.store.readMemorySnapshot(input.sessionId)).toEqual({ entries: [], diaryIndex: "" });
  });

  test("global query failure preserves the existing frozen wire and remains observable and retryable", async () => {
    const f = await fixture();
    await f.add("Prefers concise replies", "preference");
    const first = await f.service.liveContext(input);
    vi.spyOn(f.port, "search").mockRejectedValueOnce(new Error("query unavailable"));
    const failed = await f.service.liveContext({ ...input, requestId: "failed-query", topicRelation: "continue" });
    expect(renderAgentContinuityPromptWire(failed, budget)).toEqual(renderAgentContinuityPromptWire(first, budget));
    expect(failed.retrieval?.related?.status).toBe("unavailable");
    const fact = await f.add("Build uses TypeScript", "fact");
    const recovered = await f.service.liveContext({
      ...input,
      requestId: "query-recovered",
      topicRelation: "continue",
    });
    expect(recovered.relatedCandidates?.map((entry) => entry.id)).toEqual([fact.id]);
  });

  test("related knowledge and historical experiences cross sessions without becoming current progress", async () => {
    const f = await fixture();
    const knowledge = await f.add("Project uses SQLite", "fact");
    const relation = await f.add("Database belongs to the project", "relationship");
    const history = await f.add(
      "Earlier upload problem was resolved by keeping the attachment lifecycle",
      "context",
      "owner",
      "old-task",
    );
    const foreign = await f.add("Another person's private task", "context", "other-member", "foreign-task");
    vi.spyOn(f.port, "search").mockResolvedValue(
      [knowledge, relation, history, foreign].map((node) => ({
        memory: { node, score: 0.8, scores: { keyword: 0.7, semantic: 0.9 } },
        quality: f.ledger.quality(node.id),
      })),
    );
    const result = await f.service.liveContext({ ...input, sessionId: "another-session" });
    expect(result.eventCandidates).toEqual([]);
    expect(result.taskCandidates).toEqual([]);
    expect(result.relatedCandidates?.map((entry) => entry.id).sort()).toEqual(
      [knowledge.id, relation.id, history.id].sort(),
    );
    expect(result.relatedCandidates?.find((entry) => entry.id === history.id)?.matchedBy).toContain("historical_task");
    const wire = renderAgentDynamicMemoryWire(result, budget);
    expect(wire.text).toContain("historical-task-outcomes-are-reference-not-current-task-state");
    expect(wire.text).not.toContain("senera.task_memory");
    expect(result.selection.usedTokens).toBe(wire.tokenCount);
  });

  test("resumes an earlier conversation task after another topic and keeps it across compaction", async () => {
    const f = await fixture();
    await f.service.liveContext(input);
    const task = f.ledger.binding(input.sessionId, input.requestId)!;
    const context = await f.add("Upload fix awaits verification", "context", "owner", task.taskId);
    await f.service.liveContext({ ...input, requestId: "other-topic", topicRelation: "new_topic" });
    const resumedInput = {
      ...input,
      requestId: "resumed-topic",
      topicRelation: "continue" as const,
      resumeRequestId: input.requestId,
    };
    const resumed = await f.service.liveContext(resumedInput);
    expect(resumed.taskCandidates?.map((entry) => entry.id)).toEqual([context.id]);
    expect(f.ledger.binding(input.sessionId, resumedInput.requestId)?.taskId).toBe(task.taskId);
    f.service.invalidateSessionContext(input.sessionId, "task-compaction");
    const compacted = await f.service.liveContext(resumedInput);
    expect(compacted.taskCandidates).toEqual(resumed.taskCandidates);
    expect(f.ledger.binding(input.sessionId, resumedInput.requestId)?.taskId).toBe(task.taskId);
  });

  test("updated knowledge can supplement the frozen version without mutating its system bytes", async () => {
    const f = await fixture();
    const preference = await f.add("Prefers short replies", "preference");
    const first = await f.service.liveContext(input);
    const updated = {
      ...preference,
      summary: "Prefers short replies with examples",
      content: "Prefers short replies with examples",
      updatedAt: preference.updatedAt + 1,
    };
    vi.spyOn(f.port, "search").mockResolvedValue([
      { memory: { node: updated, score: 1, scores: {} }, quality: f.ledger.quality(updated.id) },
    ]);
    const next = await f.service.liveContext({ ...input, requestId: "updated", topicRelation: "continue" });
    expect(renderAgentContinuityPromptWire(next, budget)).toEqual(renderAgentContinuityPromptWire(first, budget));
    expect(next.relatedCandidates?.[0]?.id).toBe(preference.id);
    expect(next.relatedCandidates?.[0]?.revision).not.toBe(first.eventCandidates[0]?.revision);
    expect(next.relatedCandidates?.[0]?.summary).toBe(updated.summary);
  });
});
