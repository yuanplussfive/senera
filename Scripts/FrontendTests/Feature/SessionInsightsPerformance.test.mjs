import { afterEach, expect, test, vi } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { createRunRecord } from "../../../Frontend/src/store/session/sessionRunProjection.ts";
import {
  executionInspectionRows,
  executionTimings,
} from "../../../Frontend/src/features/observability/executionInspectionModel.ts";
import { insightContextTimeline } from "../../../Frontend/src/features/observability/contextEventModel.ts";
import {
  appendInsightHistory,
  createInsightRunSelector,
  mergeInsightRuns,
} from "../../../Frontend/src/features/observability/sessionInsightsModel.ts";
import {
  EmptyInsightHistory,
  loadInsightHistory,
} from "../../../Frontend/src/features/observability/sessionInsightsHistory.ts";

afterEach(() => vi.restoreAllMocks());

test("execution groups preserve request ownership and omit diagnostic and plan placeholders", () => {
  const run = createRunRecord({ requestId: "run", startedAt: "now", input: "task" });
  const base = { status: "done", title: "entry", startedAt: "now" };
  run.steps = [
    { ...base, id: "prompt", kind: "prompt" },
    { ...base, id: "model", kind: "model", modelName: "model" },
    { ...base, id: "plan", kind: "tool" },
    { ...base, id: "call", kind: "tool", callId: "call", toolName: "Read" },
    { ...base, id: "answer", kind: "answer" },
  ];
  expect(executionInspectionRows([run], { filter: "all", search: "" }).map((row) => row.id)).toEqual([
    "run:turn",
    "model",
    "call",
  ]);
  const filtered = executionInspectionRows([run], { filter: "tool", search: "read" });
  expect(filtered[1]).toMatchObject({ run, step: { callId: "call" }, nested: true });

  const batch = { id: "batch", executionMode: "parallel", size: 2 };
  const call = run.steps.find((step) => step.id === "call");
  call.toolBatch = batch;
  run.steps.splice(4, 0, { ...call, id: "failed-call", callId: "failed", status: "failed" });
  const grouped = executionInspectionRows([run], { filter: "all", search: "" });
  expect(grouped.map((row) => row.id)).toEqual(["run:turn", "model", "call", "failed-call"]);
  expect(grouped.find((row) => row.id === "call").parallel).toEqual({
    id: "call:parallel",
    count: 2,
    failed: 1,
    active: 0,
    collapsed: false,
  });
  const folded = { filter: "all", search: "", collapsedBatches: ["call:parallel"] };
  expect(executionInspectionRows([run], folded).some((row) => row.id === "failed-call")).toBe(false);
  expect(executionInspectionRows([run], folded).find((row) => row.id === "call").parallel).toMatchObject({
    collapsed: true,
    failed: 1,
  });
  // Searching and the failure filter always reveal matching calls, even inside a folded batch.
  expect(executionInspectionRows([run], { ...folded, filter: "failed" }).at(-1).id).toBe("failed-call");
  expect(executionInspectionRows([run], { ...folded, search: "read" }).some((row) => row.id === "failed-call")).toBe(
    true,
  );
  expect(executionInspectionRows([run], { ...folded, collapsedTurns: ["run"] }).map((row) => row.id)).toEqual([
    "run:turn",
  ]);
  expect(executionInspectionRows([run], { ...folded, collapsedTurns: ["run"], filter: "failed" }).at(-1).id).toBe(
    "failed-call",
  );

  const long = {
    ...run,
    requestId: "long",
    steps: Array.from({ length: 80 }, (_, index) => ({ ...base, id: `model-${index}`, kind: "model" })),
  };
  const recent = executionInspectionRows([long], { filter: "all", search: "", historyLimit: 3 });
  expect(recent.filter((row) => row.kind === "step").map((row) => row.request)).toEqual([78, 79, 80]);
  expect(recent[0]).toMatchObject({ requests: 80 });
  expect(
    executionInspectionRows([long], { filter: "all", search: "entry", historyLimit: 3 }).filter(
      (row) => row.kind === "step",
    ),
  ).toHaveLength(80);

  const timed = {
    ...run,
    steps: [
      { ...base, id: "timed", kind: "model", startedAt: "2026-10-31T07:00:00Z", durationMs: 100 },
      { ...base, id: "live", kind: "model", status: "running", startedAt: "2026-10-31T07:00:01Z" },
    ],
  };
  const timing = executionTimings(executionInspectionRows([timed], { filter: "all", search: "" }));
  expect(timing[0].end - timing[0].start).toBe(100);
  expect(timing[1].end).toBeUndefined();
});

test("persisted compaction is distinct from context differences and is replayed without duplicates", () => {
  const section = { id: "system", category: "system", label: "system", tokens: 20, characters: 80, images: 0 };
  const snapshot = {
    format: "pi-input/v1",
    scope: "native",
    measurement: "local_estimate",
    contextWindow: 1000,
    reserveTokens: 100,
    estimatedTokens: 20,
    sections: [section],
  };
  const records = [
    event(1, EventKinds.ModelStarted, { model: "first", messageIndex: 0, contextSnapshot: snapshot }),
    event(2, EventKinds.SessionCompacted, { sessionId: "session", boundaryId: "boundary", tokensBefore: 20 }),
    event(3, EventKinds.ModelStarted, {
      model: "second",
      messageIndex: 1,
      contextSnapshot: { ...snapshot, sections: [], estimatedTokens: 0 },
    }),
  ];
  const first = appendInsightHistory(new Map(), records);
  const replay = appendInsightHistory(first, records);
  const run = replay.get("run");
  expect(run.contextCompactions).toHaveLength(1);
  const timeline = insightContextTimeline([run]);
  expect(timeline.map((entry) => entry.kind)).toEqual(["model", "removed", "compaction", "initial"]);
  expect(timeline.find((entry) => entry.kind === "compaction")).toMatchObject({ requestId: run.steps[1].id });
  expect(timeline.find((entry) => entry.kind === "removed")).toMatchObject({ tokens: -20, estimated: true });
  expect(first.get("run").contextCompactions).toHaveLength(1);
});

function event(sequence, kind, data, requestId = "run") {
  return {
    channel: "agent.event",
    kind,
    sequence,
    timestamp: "2026-10-29T00:00:00Z",
    sessionId: "session",
    requestId,
    step: 1,
    data,
  };
}

function respond(through, events = [], nextCursor) {
  return new Response(JSON.stringify({ sessionId: "session", through, events, nextCursor }), {
    headers: { "Content-Type": "application/json" },
  });
}

test("answer deltas neither retain answer text nor invalidate stable insight runs", () => {
  const select = createInsightRunSelector();
  const run = createRunRecord({ requestId: "run", startedAt: "now", input: "task" });
  run.streamingRaw = "private answer";
  const first = select([run]);
  expect(first[0].streamingRaw).toBe("");
  expect(select([{ ...run, streamingRaw: "longer private answer", revision: 100 }])).toBe(first);
  const steps = [{ id: "model", kind: "model", status: "running" }];
  const second = select([{ ...run, steps }]);
  expect(second).not.toBe(first);
  expect(second[0].steps).toBe(steps);
  expect(select([{ ...run, steps, displayText: "another answer delta" }])).toBe(second);
});

test("incremental projections preserve published checkpoints and reuse unchanged merged turns", () => {
  const first = appendInsightHistory(new Map(), [
    event(1, EventKinds.ToolCallStarted, { toolName: "Read", callId: "read", batchId: "batch" }),
    event(2, EventKinds.ModelStarted, { model: "model", messageIndex: 0 }),
  ]);
  const before = structuredClone(first.get("run"));
  const next = appendInsightHistory(first, [
    event(3, EventKinds.ToolCallCompleted, { toolName: "Read", callId: "read", durationMs: 20 }),
    event(4, EventKinds.ModelCompleted, {
      messageIndex: 0,
      outcome: "completed",
      usage: { source: "provider_reported", inputTokens: 100 },
    }),
  ]);
  expect(first.get("run")).toEqual(before);
  expect(next.get("run").steps.find((step) => step.callId === "read")).toMatchObject({
    status: "done",
    durationMs: 20,
  });
  const runs = [createRunRecord({ requestId: "run", startedAt: "now", input: "task" })];
  const merged = mergeInsightRuns(runs, next);
  expect(mergeInsightRuns(runs, next)[0]).toBe(merged[0]);
  const unrelated = appendInsightHistory(next, [
    event(5, EventKinds.ModelStarted, { model: "other", messageIndex: 0 }, "other"),
  ]);
  expect(mergeInsightRuns(runs, unrelated)[0]).toBe(merged[0]);
});

test("a cancelled page resumes its fixed snapshot and subsequent refresh reads only the new tail", async () => {
  const firstAbort = new AbortController();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(respond(100, [event(1, EventKinds.ModelStarted, { model: "model", messageIndex: 0 })], 50));
  let checkpoint;
  await expect(
    loadInsightHistory("http://backend.test", "session", EmptyInsightHistory, {
      signal: firstAbort.signal,
      onPage: (page) => {
        checkpoint = page;
        firstAbort.abort();
      },
    }),
  ).rejects.toThrow();
  expect(checkpoint).toMatchObject({ cursor: 50, through: 100, complete: false });
  fetch
    .mockResolvedValueOnce(
      respond(100, [event(60, EventKinds.ModelCompleted, { messageIndex: 0, outcome: "completed" })]),
    )
    .mockResolvedValueOnce(respond(120));
  await loadInsightHistory("http://backend.test", "session", checkpoint, {
    signal: new AbortController().signal,
    onPage: (page) => {
      checkpoint = page;
    },
  });
  const resumeUrl = new URL(fetch.mock.calls[1][0]);
  expect(resumeUrl.searchParams.get("after")).toBe("50");
  expect(resumeUrl.searchParams.get("through")).toBe("100");
  expect(checkpoint).toMatchObject({ cursor: 120, complete: true });
  fetch.mockResolvedValueOnce(respond(140));
  await loadInsightHistory("http://backend.test", "session", checkpoint, {
    signal: new AbortController().signal,
    onPage: (page) => {
      checkpoint = page;
    },
  });
  const catchUpUrl = new URL(fetch.mock.calls[2][0]);
  expect(catchUpUrl.searchParams.get("after")).toBe("100");
  expect(catchUpUrl.searchParams.has("through")).toBe(false);
  const refreshUrl = new URL(fetch.mock.calls[3][0]);
  expect(refreshUrl.searchParams.get("after")).toBe("120");
  expect(refreshUrl.searchParams.has("through")).toBe(false);
  expect(checkpoint.runs.get("run").steps).toHaveLength(1);
});

test("a late response from an aborted conversation never publishes analytics", async () => {
  const abort = new AbortController();
  let resolveResponse;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveResponse = resolve;
      }),
  );
  const onPage = vi.fn();
  const pending = loadInsightHistory("http://backend.test", "session", EmptyInsightHistory, {
    signal: abort.signal,
    onPage,
  });
  abort.abort();
  resolveResponse(respond(1, [event(1, EventKinds.ModelStarted, { model: "model", messageIndex: 0 })]));
  await expect(pending).rejects.toThrow();
  expect(onPage).not.toHaveBeenCalled();
});
