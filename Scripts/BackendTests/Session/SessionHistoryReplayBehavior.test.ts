import { describe, expect, test } from "vitest";
import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "../../../Source/AgentSystem/Conversation/AgentConversation.js";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
  type AgentDomainEvent,
  type AgentEventEnvelope,
} from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { InMemorySessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentSessionEventFactory } from "../../../Source/AgentSystem/Session/AgentSessionEventFactory.js";
import { AgentSessionHistoryReplay } from "../../../Source/AgentSystem/Session/AgentSessionHistoryReplay.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";
import type { AgentHistoryStepRun } from "../../../Source/AgentSystem/Session/AgentSessionEventTypes.js";
import type { AgentToolPresentation } from "../../../Source/AgentSystem/Types/AgentToolPresentationTypes.js";

const HistoricalWebPresentation: AgentToolPresentation = {
  category: "web-search",
  icon: "search",
  group: { id: "web", title: { "en-US": "Web", "zh-CN": "网页" } },
  activity: { action: { "en-US": "Search", "zh-CN": "搜索" } },
};

const PreviousWebPresentation: AgentToolPresentation = {
  ...HistoricalWebPresentation,
  category: "legacy-web-search",
};

describe("Session history replay behavior", () => {
  test("captures the transcript after asynchronous native boundary discovery for a channel-independent Pi session", async () => {
    let commitDuringDiscovery = () => {};
    const fixture = createReplayFixture({
      readHistoryBoundary: async () => {
        commitDuringDiscovery();
        return { id: "compaction", firstKeptRequestId: "newly-committed" };
      },
    });
    const sessionId = "compaction-race";
    const { session } = fixture.store.open(sessionId);
    session.metadata = { piSession: { state: "initialized", updatedAt: new Date().toISOString() } };
    fixture.store.persistMetadata(session);
    fixture.store.persistEntries(sessionId, [userEntry("old", "Old input", 0)]);
    commitDuringDiscovery = () =>
      fixture.store.persistEntries(sessionId, [userEntry("newly-committed", "New input", 1)]);
    const events: AgentDomainEvent[] = [];
    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(replayedEntryRequestIds(events)).toEqual(["newly-committed"]);
  });
  test("a compacted Pi session replays complete current requests, paginates archives, and preserves failed runs without entries", async () => {
    const fixture = createReplayFixture({
      entryPageSize: 2,
      readHistoryBoundary: async () => ({ id: "native-compact", firstKeptRequestId: "request-2" }),
    });
    const sessionId = "local-qq-window";
    const { session } = fixture.store.open(sessionId);
    session.metadata = {
      ...session.metadata,
      piSession: { state: "initialized", updatedAt: new Date().toISOString() },
    };
    fixture.store.persistMetadata(session);
    for (let index = 0; index < 4; index += 1) {
      const requestId = `request-${index}`;
      if (index !== 3) {
        fixture.store.persistEntries(sessionId, [
          userEntry(requestId, `input-${index}`, index * 10),
          assistantEntry(requestId, "<final>Done</final>", index * 10 + 1),
        ]);
      }
      fixture.store.persistRunSnapshot(
        snapshot(sessionId, requestId, index === 3 ? "failed" : "completed", index * 10),
      );
      fixture.store.persistTurnArtifacts(
        sessionId,
        requestId,
        [],
        [{ ...stepTrace(index), toolName: "BrowserOpen", toolResult: "durable result" }],
      );
    }
    fixture.store.persistRunEvent(sessionId, {
      ...runEvent(sessionId, "request-3", 31),
      kind: AgentEventKinds.ToolCallFailed,
      phase: AgentEventPhases.Tool,
      data: { index: 0, toolName: "BrowserOpen", callId: "failed-call", message: "Navigation failed" },
    });
    const events: AgentDomainEvent[] = [];
    const onEvent = (event: AgentDomainEvent) => {
      events.push(event);
    };
    await fixture.replay.replay({ sessionId, onEvent });
    expect(events[0]).toMatchObject({
      kind: AgentEventKinds.SessionHistoryStarted,
      data: {
        window: {
          boundaryId: "native-compact",
          before: "request-2",
          mode: "replace",
          requestIds: ["request-2", "request-3"],
        },
      },
    });
    expect(replayedEntryRequestIds(events)).toEqual(["request-2", "request-2"]);
    const runs = events.flatMap((event) => (event.kind === AgentEventKinds.SessionHistorySteps ? event.data.runs : []));
    expect(runs.map((run) => run.requestId)).toEqual(["request-2", "request-3"]);
    expect(
      events
        .filter((event) => event.kind === AgentEventKinds.SessionRunHistoryChunk)
        .flatMap((event) => event.data.events),
    ).toContainEqual(
      expect.objectContaining({
        kind: AgentEventKinds.ToolCallFailed,
        data: expect.objectContaining({ message: "Navigation failed" }),
      }),
    );
    events.length = 0;
    await fixture.replay.replay({ sessionId, before: "request-2", onEvent });
    expect(events[0]).toMatchObject({
      data: { window: { mode: "prepend", requestIds: ["request-0", "request-1"], before: undefined } },
    });
    expect(replayedEntryRequestIds(events)).toEqual(["request-0", "request-0", "request-1", "request-1"]);
    expect(fixture.store.loadConversation(sessionId)).toHaveLength(6);
  });
  test("requested tool details survive without a lifecycle snapshot and complete even when no events remain", async () => {
    const fixture = createReplayFixture();
    const sessionId = "legacy-tool-details";
    fixture.store.open(sessionId);
    fixture.store.persistRunEvent(sessionId, {
      ...runEvent(sessionId, "legacy-request", 1),
      kind: AgentEventKinds.ToolCallFailed,
      phase: AgentEventPhases.Tool,
      data: { index: 0, toolName: "BrowserOpen", callId: "legacy-call", message: "Page closed" },
    });
    const events: AgentDomainEvent[] = [];
    for (const requestId of ["legacy-request", "missing-request"]) {
      await fixture.replay.replayRunHistory({
        sessionId,
        requestId,
        onEvent: (event) => {
          events.push(event);
        },
      });
    }
    expect(events).toEqual([
      expect.objectContaining({
        kind: AgentEventKinds.SessionRunHistoryDetail,
        data: expect.objectContaining({
          requestId: "legacy-request",
          complete: true,
          events: [expect.objectContaining({ kind: AgentEventKinds.ToolCallFailed })],
        }),
      }),
      expect.objectContaining({
        kind: AgentEventKinds.SessionRunHistoryDetail,
        data: { sessionId, requestId: "missing-request", events: [], complete: true },
      }),
    ]);
  });

  test("projects recovery actions from stored run status for historical failures", async () => {
    const fixture = createReplayFixture();
    const sessionId = "historical-recovery";
    fixture.store.open(sessionId);
    for (const [index, status] of (["failed", "cancelled", "running", "completed"] as const).entries()) {
      fixture.store.persistRunSnapshot(snapshot(sessionId, `request-${status}`, status, index));
    }
    const events: AgentDomainEvent[] = [];
    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });
    const runs = events.flatMap((event) => (event.kind === AgentEventKinds.SessionHistorySteps ? event.data.runs : []));
    expect(runs.find((run) => run.requestId === "request-failed")?.recoveryModes).toEqual(["retry", "continue"]);
    expect(runs.find((run) => run.requestId === "request-cancelled")?.recoveryModes).toEqual(["retry", "continue"]);
    expect(runs.find((run) => run.requestId === "request-running")?.recoveryModes).toEqual([]);
    // A display warning about missing trace data cannot make a successful run recoverable.
    expect(runs.find((run) => run.requestId === "request-completed")?.recoveryModes).toEqual([]);
  });

  test("emits not-found without starting replay for an unknown session", async () => {
    const fixture = createReplayFixture();
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId: "missing-session",
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        kind: AgentEventKinds.SessionNotFound,
        data: expect.objectContaining({ operation: "session.history" }),
      }),
    ]);
  });

  test("updates only the replay presentation for a trace confirmed by the current tool catalog", async () => {
    const fixture = createReplayFixture({
      createPresentationResolver: (trace) =>
        trace.toolName === "WebSearch" &&
        trace.toolOrigin?.kind === "system" &&
        trace.toolOrigin.capability === "web.search"
          ? HistoricalWebPresentation
          : undefined,
    });
    const sessionId = "presentation-reconciliation";
    fixture.store.open(sessionId);
    fixture.store.persistTurnArtifacts(
      sessionId,
      "request-1",
      [],
      [
        {
          step: 1,
          seq: 1,
          kind: "tool",
          status: "done",
          toolName: "WebSearch",
          toolOrigin: {
            kind: "system",
            name: "Web",
            capability: "web.search",
            presentation: PreviousWebPresentation,
          },
        },
        {
          step: 2,
          seq: 2,
          kind: "tool",
          status: "done",
          toolName: "Unknown",
          toolOrigin: {
            kind: "system",
            name: "Unknown",
            capability: "unknown.tool",
            presentation: PreviousWebPresentation,
          },
        },
      ],
    );

    const events: AgentDomainEvent[] = [];
    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });
    const traces = events
      .flatMap((event) => (event.kind === AgentEventKinds.SessionHistorySteps ? event.data.runs : []))
      .flatMap((run) => run.traces);

    expect(traces[0]?.toolOrigin?.presentation).toEqual(HistoricalWebPresentation);
    expect(traces[0]?.toolOrigin?.name).toBe("Web");
    expect(traces[1]?.toolOrigin?.presentation).toEqual(PreviousWebPresentation);
  });

  test.each([false, true])("restores completed thinking with bounded reads (compacted=%s)", async (compacted) => {
    const fixture = createReplayFixture({
      repository: new PageOnlyHistoryRepository(),
      entryPageSize: 1,
      stepRunPageSize: 1,
      runEventPageSize: 1,
      readHistoryBoundary: compacted
        ? async () => ({ id: "thinking-boundary", firstKeptRequestId: "request-1" })
        : undefined,
    });
    const sessionId = "thinking-history";
    const { session } = fixture.store.open(sessionId);
    session.metadata = { piSession: { state: "initialized", updatedAt: timestamp(0) } };
    fixture.store.persistMetadata(session);
    for (let index = 0; index < 2; index += 1) {
      const requestId = `request-${index}`;
      fixture.store.persistEntries(sessionId, [userEntry(requestId, requestId, index)]);
      fixture.store.persistTurnArtifacts(sessionId, requestId, [], [stepTrace(index)]);
      fixture.store.persistRunSnapshot(snapshot(sessionId, requestId, "completed", index));
      fixture.store.persistRunEvent(sessionId, runEvent(sessionId, requestId, index * 10));
      fixture.store.persistRunEvent(sessionId, thinkingEvent(sessionId, requestId, index * 10 + 1, 0));
      fixture.store.persistRunEvent(sessionId, thinkingEvent(sessionId, requestId, index * 10 + 2, 1));
    }
    const events: AgentDomainEvent[] = [];
    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
        if (event.kind === AgentEventKinds.SessionHistoryStarted) {
          fixture.store.persistRunEvent(sessionId, thinkingEvent(sessionId, "request-1", 30, 2));
        }
      },
    });
    const thinking = replayedRunEvents(events);
    expect(thinking.map((event) => [event.requestId, (event.data as { contentIndex: number }).contentIndex])).toEqual(
      compacted
        ? [
            ["request-1", 0],
            ["request-1", 1],
          ]
        : [
            ["request-0", 0],
            ["request-0", 1],
            ["request-1", 0],
            ["request-1", 1],
          ],
    );
    expect(thinking.every((event) => event.kind === AgentEventKinds.ModelThinkingCompleted)).toBe(true);
    if (compacted) {
      events.length = 0;
      await fixture.replay.replay({
        sessionId,
        before: "request-1",
        onEvent: (event) => {
          events.push(event);
        },
      });
      expect(replayedRunEvents(events).map((event) => event.requestId)).toEqual(["request-0", "request-0"]);
    }
  });

  test("streams transcript pages without raw events for completed history", async () => {
    const fixture = createReplayFixture();
    const sessionId = "chunked-session";
    fixture.store.open(sessionId);
    const entries = Array.from({ length: 51 }, (_, index) => userEntry(`request-${index}`, `message-${index}`, index));
    fixture.store.persistEntries(sessionId, entries);
    Array.from({ length: 121 }, (_, index) => runEvent(sessionId, `request-${index}`, index)).forEach((event) =>
      fixture.store.persistRunEvent(sessionId, event),
    );
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      refresh: true,
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.SessionHistoryStarted,
      AgentEventKinds.SessionHistoryChunk,
      AgentEventKinds.SessionHistoryChunk,
      AgentEventKinds.SessionHistoryCompleted,
    ]);
    const entryChunks = events.filter((event) => event.kind === AgentEventKinds.SessionHistoryChunk);
    expect(entryChunks.map((event) => readArrayLength(event.data, "entries"))).toEqual([50, 1]);
    const runChunks = events.filter((event) => event.kind === AgentEventKinds.SessionRunHistoryChunk);
    expect(runChunks).toEqual([]);
    expect(events.at(0)?.data).toEqual(
      expect.objectContaining({
        totalEntries: 51,
        messageCount: 51,
        refresh: true,
      }),
    );
  });

  test("emits an optional recent preview before the full replay", async () => {
    const fixture = createReplayFixture({ entryPageSize: 2 });
    const sessionId = "recent-preview-session";
    fixture.store.open(sessionId);
    fixture.store.persistEntries(
      sessionId,
      Array.from({ length: 5 }, (_, index) => userEntry(`request-${index}`, `message-${index}`, index)),
    );
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      initialWindow: true,
      onEvent: (event) => {
        events.push(event);
      },
    });

    const chunks = events.filter((event) => event.kind === AgentEventKinds.SessionHistoryChunk);
    expect(chunks.map((event) => readArrayLength(event.data, "entries"))).toEqual([2, 2, 2, 1]);
    expect(readRecord(chunks[0]?.data)?.preview).toBe(true);
    expect(readRecord(chunks[1]?.data)?.preview).toBeUndefined();
  });

  test("splits oversized run-event pages before sending them", async () => {
    const fixture = createReplayFixture({ maxRunEventChunkBytes: 1_000 });
    const sessionId = "byte-bounded-session";
    const requestId = "request-failed";
    fixture.store.open(sessionId);
    fixture.store.persistRunSnapshot(snapshot(sessionId, requestId, "failed", 0));
    for (let index = 0; index < 3; index += 1) {
      fixture.store.persistRunEvent(sessionId, {
        ...runEvent(sessionId, requestId, index),
        data: { input: "x".repeat(500) },
      });
    }
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });

    const runChunks = events.filter((event) => event.kind === AgentEventKinds.SessionRunHistoryChunk);
    expect(runChunks).toHaveLength(3);
    expect(
      runChunks.every(
        (event) =>
          Buffer.byteLength(JSON.stringify({ sessionId, events: readRecord(event.data)?.events ?? [] })) <= 1_000,
      ),
    ).toBe(true);
  });

  test("uses repository pages without calling the legacy full-history readers", async () => {
    const repository = new PageOnlyHistoryRepository();
    const fixture = createReplayFixture({
      repository,
      entryPageSize: 2,
      stepRunPageSize: 2,
      runEventPageSize: 2,
    });
    const sessionId = "page-only-session";
    fixture.store.open(sessionId);
    fixture.store.persistEntries(
      sessionId,
      Array.from({ length: 5 }, (_, index) => userEntry(`request-${index}`, `message-${index}`, index)),
    );
    for (let index = 0; index < 5; index += 1) {
      fixture.store.persistTurnArtifacts(sessionId, `request-${index}`, [], [stepTrace(index)]);
      fixture.store.persistRunSnapshot(snapshot(sessionId, `request-${index}`, "completed", index));
    }
    Array.from({ length: 5 }, (_, index) => runEvent(sessionId, `request-${index}`, index)).forEach((event) =>
      fixture.store.persistRunEvent(sessionId, event),
    );
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(
      events
        .filter((event) => event.kind === AgentEventKinds.SessionHistoryChunk)
        .map((event) => readArrayLength(event.data, "entries")),
    ).toEqual([2, 2, 1]);
    expect(
      events
        .filter((event) => event.kind === AgentEventKinds.SessionRunHistoryChunk)
        .map((event) => readArrayLength(event.data, "events")),
    ).toEqual([]);
    expect(
      events
        .filter((event) => event.kind === AgentEventKinds.SessionHistorySteps)
        .map((event) => readArrayLength(event.data, "runs")),
    ).toEqual([2, 2, 1]);
  });

  test("replays a fixed high-water snapshot when new completed history arrives after replay starts", async () => {
    const fixture = createReplayFixture({ entryPageSize: 1, runEventPageSize: 1 });
    const sessionId = "fixed-history-snapshot";
    fixture.store.open(sessionId);
    fixture.store.persistEntries(sessionId, [userEntry("request-before", "before", 1)]);
    fixture.store.persistRunEvent(sessionId, runEvent(sessionId, "request-before", 1));
    fixture.store.persistRunSnapshot(snapshot(sessionId, "request-before", "completed", 1));
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
        if (event.kind !== AgentEventKinds.SessionHistoryStarted) return;
        fixture.store.persistEntries(sessionId, [userEntry("request-after", "after", 2)]);
        fixture.store.persistRunEvent(sessionId, runEvent(sessionId, "request-after", 2));
        fixture.store.persistRunSnapshot(snapshot(sessionId, "request-after", "completed", 2));
      },
    });

    expect(replayedEntryRequestIds(events)).toEqual(["request-before"]);
    expect(replayedStepRequestIds(events)).toEqual(["request-before"]);
    expect(replayedRunEventRequestIds(events)).toEqual([]);
  });

  test("restores bounded tool result details for a failed run during initial history replay", async () => {
    const fixture = createReplayFixture();
    const sessionId = "failed-tool-result";
    const requestId = "request-failed-tool-result";
    fixture.store.open(sessionId);
    fixture.store.persistRunSnapshot({
      ...snapshot(sessionId, requestId, "failed", 1),
      errorMessage: "The following tool failed.",
    });
    fixture.store.persistRunEvent(sessionId, {
      ...runEvent(sessionId, requestId, 1),
      kind: AgentEventKinds.ToolCallStarted,
      layer: AgentEventLayers.Progress,
      phase: AgentEventPhases.Tool,
      step: 1,
      data: {
        index: 0,
        toolName: "WorkspaceRead",
        callId: "call-1",
        arguments: { path: "README.md" },
      },
    });
    fixture.store.persistRunEvent(sessionId, {
      ...runEvent(sessionId, requestId, 2),
      kind: AgentEventKinds.ToolCallResultDetail,
      layer: AgentEventLayers.Snapshot,
      phase: AgentEventPhases.Tool,
      step: 1,
      data: {
        detailId: "detail-1",
        index: 0,
        toolName: "WorkspaceRead",
        callId: "call-1",
        value: {
          path: "README.md",
          contents: "x".repeat(2_000_000),
        },
      },
    });
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(replayedRunEvents(events)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: AgentEventKinds.ToolCallResultDetail,
          data: expect.objectContaining({
            callId: "call-1",
            value: expect.objectContaining({ path: "README.md" }),
          }),
        }),
      ]),
    );
  });

  test("keeps run-snapshot values fixed when a run settles after replay starts", async () => {
    const fixture = createReplayFixture({ stepRunPageSize: 1 });
    const sessionId = "fixed-run-snapshot-value";
    const requestId = "request-settling";
    fixture.store.open(sessionId);
    fixture.store.persistRunSnapshot(snapshot(sessionId, requestId, "running", 1));
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
        if (event.kind !== AgentEventKinds.SessionHistoryStarted) return;
        fixture.store.persistRunSnapshot({
          ...snapshot(sessionId, requestId, "failed", 1),
          errorMessage: "Settled after replay started.",
        });
      },
    });

    expect(replayedStepRuns(events)).toEqual([expect.objectContaining({ requestId, status: "running" })]);
    expect(fixture.store.loadRunSnapshots(sessionId)).toEqual([
      expect.objectContaining({ requestId, status: "failed" }),
    ]);
  });

  test("merges persisted traces and lifecycle snapshots into stable history runs", async () => {
    const fixture = createReplayFixture();
    const sessionId = "run-session";
    fixture.store.open(sessionId);
    const entries = [
      userEntry("request-complete", "Complete request", 1),
      assistantEntry("request-complete", "Complete answer", 2),
      userEntry("request-missing-data", "Missing trace request", 3),
      userEntry("request-running", "Running request", 4),
      userEntry("request-failed", "Failed request", 5),
    ];
    fixture.store.persistEntries(sessionId, entries);
    fixture.store.persistTurnArtifacts(
      sessionId,
      "request-complete",
      [],
      [
        {
          step: 1,
          seq: 0,
          kind: "answer",
          status: "done",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:02.000Z",
        },
      ],
    );
    fixture.store.persistRunSnapshot(snapshot(sessionId, "request-complete", "completed", 1));
    fixture.store.persistRunSnapshot(snapshot(sessionId, "request-missing-data", "completed", 3));
    fixture.store.persistRunSnapshot(snapshot(sessionId, "request-running", "running", 4));
    fixture.store.persistRunSnapshot(snapshot(sessionId, "request-failed", "failed", 5));

    const events: AgentDomainEvent[] = [];
    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });
    const runs = replayedStepRuns(events);

    expect(
      runs.map((run) => ({
        requestId: run.requestId,
        status: run.status,
        traces: run.traces.length,
      })),
    ).toEqual([
      { requestId: "request-complete", status: "completed", traces: 1 },
      { requestId: "request-missing-data", status: "failed", traces: 1 },
      { requestId: "request-running", status: "running", traces: 0 },
      { requestId: "request-failed", status: "failed", traces: 1 },
    ]);
    expect(runs[0]).toEqual(
      expect.objectContaining({
        input: "Complete request",
        endedAt: "2026-01-01T00:00:02.000Z",
      }),
    );
    expect(runs[1]?.traces[0]).toEqual(
      expect.objectContaining({
        kind: "answer",
        status: "failed",
        title: "回复数据丢失",
        errorMessage: expect.stringContaining("重新发送请求"),
      }),
    );
  });

  test("projects assistant decision entries as visible final answers", async () => {
    const fixture = createReplayFixture();
    const sessionId = "assistant-session";
    fixture.store.open(sessionId);
    fixture.store.persistEntries(sessionId, [assistantEntry("request-answer", "Visible answer", 1)]);
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });

    const chunk = events.find((event) => event.kind === AgentEventKinds.SessionHistoryChunk);
    const entries = readRecord(chunk?.data)?.entries;
    expect(entries).toEqual([
      expect.objectContaining({
        visible: { kind: "final_answer", text: "Visible answer" },
      }),
    ]);
  });

  test("extracts the user-visible answer from persisted final-answer XML", async () => {
    const fixture = createReplayFixture();
    const sessionId = "assistant-xml-session";
    fixture.store.open(sessionId);
    fixture.store.persistEntries(sessionId, [
      assistantEntry("request-xml", "<FinalAnswer><answer>XML answer</answer></FinalAnswer>", 1),
    ]);
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });

    const chunk = events.find((event) => event.kind === AgentEventKinds.SessionHistoryChunk);
    expect(readRecord(chunk?.data)?.entries).toEqual([
      expect.objectContaining({ visible: { kind: "final_answer", text: "XML answer" } }),
    ]);
  });

  test("keeps a failed snapshot failed even when partial traces were persisted", async () => {
    const fixture = createReplayFixture();
    const sessionId = "failed-with-trace";
    const requestId = "request-failed-with-trace";
    fixture.store.open(sessionId);
    const entries = [userEntry(requestId, "Run the task", 1)];
    fixture.store.persistEntries(sessionId, entries);
    fixture.store.persistTurnArtifacts(
      sessionId,
      requestId,
      [],
      [
        {
          step: 1,
          seq: 0,
          kind: "tool",
          status: "done",
          startedAt: timestamp(1),
          endedAt: timestamp(2),
        },
      ],
    );
    fixture.store.persistRunSnapshot({
      ...snapshot(sessionId, requestId, "failed", 1),
      errorMessage: "The next step failed.",
    });

    const events: AgentDomainEvent[] = [];
    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(replayedStepRuns(events)).toEqual([
      expect.objectContaining({ requestId, status: "failed", traces: expect.any(Array) }),
    ]);
  });

  test("recovers unresolved approvals and interaction input for terminal runs", async () => {
    const fixture = createReplayFixture();
    const sessionId = "interrupted-waits-session";
    const requestId = "request-interrupted";
    fixture.store.open(sessionId);
    fixture.store.persistEntries(sessionId, [userEntry(requestId, "Run an approved command", 1)]);
    fixture.store.persistRunSnapshot({
      ...snapshot(sessionId, requestId, "failed", 1),
      errorMessage: "Run interrupted by server restart.",
    });
    fixture.store.persistRunEvent(sessionId, runEvent(sessionId, requestId, 1));
    fixture.store.persistRunEvent(
      sessionId,
      waitEvent(sessionId, requestId, 2, AgentEventKinds.ApprovalRequested, {
        approvalId: "approval-interrupted",
        status: "pending",
      }),
    );
    fixture.store.persistRunEvent(
      sessionId,
      waitEvent(sessionId, requestId, 3, AgentEventKinds.InteractionInputRequested, {
        interactionId: "interaction-interrupted",
        status: "pending",
      }),
    );
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });

    const chunks = events.filter((event) => event.kind === AgentEventKinds.SessionRunHistoryChunk);
    const replayed = chunks.flatMap((event) => {
      const value = readRecord(event.data)?.events;
      return Array.isArray(value) ? value : [];
    }) as AgentEventEnvelope[];
    expect(replayed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: AgentEventKinds.ApprovalResolved,
          data: expect.objectContaining({
            approvalId: "approval-interrupted",
            status: "cancelled",
            disposition: "interrupt",
          }),
        }),
        expect.objectContaining({
          kind: AgentEventKinds.InteractionInputResolved,
          data: expect.objectContaining({
            interactionId: "interaction-interrupted",
            status: "resolved",
            action: "cancel",
          }),
        }),
      ]),
    );
  });

  test("does not synthesize a wait resolution when the persisted resolution is on a later page", async () => {
    const fixture = createReplayFixture({ runEventPageSize: 1 });
    const sessionId = "resolved-wait-pages";
    const requestId = "request-resolved-wait";
    fixture.store.open(sessionId);
    fixture.store.persistRunSnapshot(snapshot(sessionId, requestId, "failed", 1));
    fixture.store.persistRunEvent(
      sessionId,
      waitEvent(sessionId, requestId, 1, AgentEventKinds.ApprovalRequested, {
        approvalId: "approval-resolved",
        status: "pending",
      }),
    );
    fixture.store.persistRunEvent(sessionId, {
      ...waitEvent(sessionId, requestId, 2, AgentEventKinds.ApprovalRequested, {
        approvalId: "approval-resolved",
        status: "approved",
      }),
      kind: AgentEventKinds.ApprovalResolved,
    });
    const events: AgentDomainEvent[] = [];

    await fixture.replay.replay({
      sessionId,
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(replayedRunEvents(events).filter((event) => event.kind === AgentEventKinds.ApprovalResolved)).toEqual([
      expect.not.objectContaining({ detailId: expect.stringContaining("history_recovered") }),
    ]);
  });
});

function createReplayFixture(
  options: {
    repository?: InMemorySessionRepository;
    entryPageSize?: number;
    stepRunPageSize?: number;
    runEventPageSize?: number;
    maxRunEventChunkBytes?: number;
    readHistoryBoundary?: import("../../../Source/AgentSystem/Session/AgentSessionHistoryReplay.js").AgentSessionHistoryReplayOptions["readHistoryBoundary"];
    createPresentationResolver?: import("../../../Source/AgentSystem/Session/AgentSessionHistoryReplay.js").AgentSessionHistoryPresentationResolver;
  } = {},
) {
  const store = new AgentSessionStore({ repository: options.repository ?? new InMemorySessionRepository() });
  const presentationResolver = options.createPresentationResolver;
  const replay = new AgentSessionHistoryReplay({
    store,
    eventFactory: new AgentSessionEventFactory(),
    createPresentationResolver: presentationResolver ? () => presentationResolver : undefined,
    paging: {
      entryPageSize: options.entryPageSize,
      stepRunPageSize: options.stepRunPageSize,
      runEventPageSize: options.runEventPageSize,
    },
    maxRunEventChunkBytes: options.maxRunEventChunkBytes,
    readHistoryBoundary: options.readHistoryBoundary,
  });
  return { replay, store };
}

class PageOnlyHistoryRepository extends InMemorySessionRepository {
  override loadRunEventsForRequest(): AgentEventEnvelope[] {
    throw new Error("Full request-event loading is forbidden during compact completed history replay.");
  }

  override loadEntries(): AgentConversationEntry[] {
    throw new Error("Full conversation loading is forbidden during paged history replay.");
  }

  override loadRunEvents(): AgentEventEnvelope[] {
    throw new Error("Full run-event loading is forbidden during paged history replay.");
  }

  override loadStepTraces(_sessionId: string): never {
    throw new Error("Full step-trace loading is forbidden during paged history replay.");
  }

  override loadRunSnapshots(_sessionId: string): never {
    throw new Error("Full run-snapshot loading is forbidden during paged history replay.");
  }

  override loadEntriesForRequests(
    sessionId: string,
    requestIds: readonly string[],
    throughSequence: number,
  ): AgentConversationEntry[] {
    assertBoundedLookup(requestIds, 2);
    return super.loadEntriesForRequests(sessionId, requestIds, throughSequence);
  }

  override loadRunSnapshotsForRequests(sessionId: string, requestIds: readonly string[], throughSequence: number) {
    assertBoundedLookup(requestIds, 2);
    return super.loadRunSnapshotsForRequests(sessionId, requestIds, throughSequence);
  }

  override loadStepTraceRequestIds(sessionId: string, requestIds: readonly string[], throughRowId: number) {
    assertBoundedLookup(requestIds, 2);
    return super.loadStepTraceRequestIds(sessionId, requestIds, throughRowId);
  }
}

function assertBoundedLookup(requestIds: readonly string[], maximum: number): void {
  if (requestIds.length > maximum) throw new Error(`Request lookup exceeded page bound: ${requestIds.length}`);
}

function userEntry(
  requestId: string,
  content: string,
  offset: number,
): Extract<AgentConversationEntry, { kind: "user.message" }> {
  return {
    id: `${requestId}:user`,
    requestId,
    timestamp: timestamp(offset),
    kind: AgentConversationEntryKinds.UserMessage,
    content,
  };
}

function assistantEntry(
  requestId: string,
  content: string,
  offset: number,
): Extract<AgentConversationEntry, { kind: "assistant.decision" }> {
  return {
    id: `${requestId}:assistant`,
    requestId,
    timestamp: timestamp(offset),
    kind: AgentConversationEntryKinds.AssistantDecision,
    xml: content,
  };
}

function snapshot(
  sessionId: string,
  requestId: string,
  status: "running" | "completed" | "failed" | "cancelled",
  offset: number,
) {
  return {
    sessionId,
    requestId,
    input: requestId,
    status,
    startedAt: timestamp(offset),
    updatedAt: timestamp(offset + 1),
    endedAt: status === "running" ? undefined : timestamp(offset + 1),
  };
}

function runEvent(sessionId: string, requestId: string, sequence: number): AgentEventEnvelope {
  return {
    channel: AgentEventChannels.AgentEvent,
    kind: AgentEventKinds.RunStarted,
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Run,
    sequence,
    timestamp: timestamp(sequence),
    sessionId,
    requestId,
    data: { input: requestId },
  };
}

function thinkingEvent(
  sessionId: string,
  requestId: string,
  sequence: number,
  contentIndex: number,
): AgentEventEnvelope {
  return {
    ...runEvent(sessionId, requestId, sequence),
    kind: AgentEventKinds.ModelThinkingCompleted,
    phase: AgentEventPhases.Model,
    step: 1,
    data: { messageIndex: 0, contentIndex, content: `Thinking ${sequence}`, status: "complete" },
  };
}

function stepTrace(offset: number) {
  return {
    step: offset + 1,
    seq: 0,
    kind: "tool" as const,
    status: "done" as const,
    startedAt: timestamp(offset),
    endedAt: timestamp(offset + 1),
  };
}

function waitEvent(
  sessionId: string,
  requestId: string,
  sequence: number,
  kind: typeof AgentEventKinds.ApprovalRequested | typeof AgentEventKinds.InteractionInputRequested,
  data: Record<string, unknown>,
): AgentEventEnvelope {
  return {
    channel: AgentEventChannels.AgentEvent,
    kind,
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Approval,
    sequence,
    timestamp: timestamp(sequence),
    sessionId,
    requestId,
    step: 1,
    data,
  };
}

function timestamp(offset: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).toISOString();
}

function readArrayLength(value: unknown, key: string): number {
  const candidate = readRecord(value)?.[key];
  return Array.isArray(candidate) ? candidate.length : 0;
}

function replayedEntryRequestIds(events: readonly AgentDomainEvent[]): string[] {
  return events
    .filter((event) => event.kind === AgentEventKinds.SessionHistoryChunk)
    .flatMap((event) => {
      const entries = readRecord(event.data)?.entries;
      return Array.isArray(entries)
        ? entries.flatMap((item) => {
            const entry = readRecord(readRecord(item)?.entry);
            return typeof entry?.requestId === "string" ? [entry.requestId] : [];
          })
        : [];
    });
}

function replayedRunEvents(events: readonly AgentDomainEvent[]): AgentEventEnvelope[] {
  return events
    .filter((event) => event.kind === AgentEventKinds.SessionRunHistoryChunk)
    .flatMap((event) => {
      const items = readRecord(event.data)?.events;
      return Array.isArray(items) ? (items as AgentEventEnvelope[]) : [];
    });
}

function replayedStepRequestIds(events: readonly AgentDomainEvent[]): string[] {
  return replayedStepRuns(events).map((run) => run.requestId);
}

function replayedStepRuns(events: readonly AgentDomainEvent[]): AgentHistoryStepRun[] {
  return events
    .filter((event) => event.kind === AgentEventKinds.SessionHistorySteps)
    .flatMap((event) => {
      const runs = readRecord(event.data)?.runs;
      return Array.isArray(runs) ? (runs as AgentHistoryStepRun[]) : [];
    });
}

function replayedRunEventRequestIds(events: readonly AgentDomainEvent[]): string[] {
  return replayedRunEvents(events).flatMap((event) => (event.requestId ? [event.requestId] : []));
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
