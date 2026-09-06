import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { coalesceStreamingEvents } from "../../../Frontend/src/api/streamingEventCoalescer.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestRequestId, TestSessionId } from "./sessionProjectorTestUtils.mjs";

test("history events can hydrate a session before a snapshot arrives", () => {
  const state = createTestState();
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryStarted,
      { sessionId: TestSessionId, totalEntries: 0, messageCount: 0 },
      { sessionId: TestSessionId },
    ),
  );
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }, { sessionId: TestSessionId }),
  );

  expect(state.sessions[TestSessionId]).toBeTruthy();
  expect(state.historyLoadedIds[TestSessionId]).toBe(true);
});

test("event receipts deduplicate live delivery and individual events replayed after coalescing", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "stream" }, { eventId: "event-run" }));
  applyEvent(
    state,
    createEvent(EventKinds.ModelStarted, { model: "test" }, { eventId: "event-model", phase: "model" }),
  );
  const first = createEvent(EventKinds.ModelDelta, { text: "你" }, { eventId: "event-delta-1", phase: "model" });
  const second = createEvent(EventKinds.ModelDelta, { text: "好" }, { eventId: "event-delta-2", phase: "model" });
  const [coalesced] = coalesceStreamingEvents([first, second]);
  if (!coalesced) throw new Error("Expected coalesced model output.");

  applyEvent(state, coalesced);
  applyEvent(state, first);
  applyEvent(state, second);

  expect(state.sessions[TestSessionId]?.runs[0]?.streamingRaw).toBe("你好");
  expect(state.processedEventIdOrder).toEqual(["event-run", "event-model", "event-delta-1", "event-delta-2"]);
});

test("history refresh does not replace an active stream with older replay output", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "stream" }, { eventId: "live-run" }));
  applyEvent(state, createEvent(EventKinds.ModelStarted, { model: "test" }, { eventId: "live-model", phase: "model" }));
  const liveDelta = createEvent(
    EventKinds.ModelDelta,
    { text: "当前实时文本" },
    { eventId: "live-delta", phase: "model" },
  );
  applyEvent(state, liveDelta);
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryStarted,
      { sessionId: TestSessionId, totalEntries: 0, messageCount: 0, refresh: true },
      { eventId: "history-start", requestId: undefined, phase: "session" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionRunHistoryChunk,
      {
        sessionId: TestSessionId,
        events: [
          createEvent(EventKinds.RunStarted, { input: "stream" }, { eventId: "history-run" }),
          createEvent(EventKinds.ModelStarted, { model: "test" }, { eventId: "history-model", phase: "model" }),
          createEvent(EventKinds.ModelDelta, { text: "过期回放文本" }, { eventId: "history-delta", phase: "model" }),
        ],
      },
      { eventId: "history-events", requestId: undefined, phase: "session" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryCompleted,
      { sessionId: TestSessionId, refresh: true },
      { eventId: "history-complete", requestId: undefined, phase: "session" },
    ),
  );
  applyEvent(state, liveDelta);

  const run = state.sessions[TestSessionId]?.runs[0];
  expect(run?.status).toBe("running");
  expect(run?.streamingRaw).toBe("当前实时文本");
  expect(state.sessions[TestSessionId]?.activeRequestId).toBe(TestRequestId);
});

test("a live run failure that races history replay does not clear the conversation", () => {
  const state = createTestState({
    sessions: {
      [TestSessionId]: {
        sessionId: TestSessionId,
        title: "配置 QQ 渠道",
        status: "ready",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:01.000Z",
        entryCount: 1,
        messageCount: 1,
        messages: [
          {
            id: `${TestRequestId}-user`,
            role: "user",
            content: "帮我配置一下qq渠道",
            createdAt: "2026-07-09T00:00:01.000Z",
            requestId: TestRequestId,
          },
        ],
        runs: [],
        activeRequestId: TestRequestId,
      },
    },
    sessionOrder: [TestSessionId],
    activeSessionId: TestSessionId,
  });

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionSnapshot,
      {
        sessionId: TestSessionId,
        status: "running",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:01.000Z",
        entryCount: 1,
        messageCount: 1,
        turnCount: 1,
        activeRequestId: TestRequestId,
      },
      { requestId: undefined, phase: "session" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryStarted,
      { sessionId: TestSessionId, totalEntries: 1, messageCount: 1 },
      { requestId: undefined, phase: "session" },
    ),
  );

  // The run can finish on the server while the reconnecting client is still
  // waiting for history.run.started to arrive.
  applyEvent(
    state,
    createEvent(
      EventKinds.RunFailed,
      { message: "QQ 配置失败", code: "channel_connect_failed" },
      { eventId: "live-run-failed", requestId: TestRequestId, layer: "error", phase: "run" },
    ),
  );

  expect(state.historyLoadingIds[TestSessionId]).toBe(true);
  expect(state.historyFailedIds[TestSessionId]).toBeUndefined();
  expect(state.sessions[TestSessionId]?.messages).toHaveLength(1);

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistorySteps,
      {
        sessionId: TestSessionId,
        runs: [
          {
            requestId: TestRequestId,
            input: "帮我配置一下qq渠道",
            startedAt: "2026-07-09T00:00:01.000Z",
            endedAt: "2026-07-09T00:00:02.000Z",
            status: "failed",
            traces: [],
          },
        ],
      },
      { requestId: undefined, phase: "session" },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionHistoryCompleted,
      { sessionId: TestSessionId },
      { requestId: undefined, phase: "session" },
    ),
  );

  expect(state.historyLoadedIds[TestSessionId]).toBe(true);
  expect(state.historyFailedIds[TestSessionId]).toBeUndefined();
  expect(state.sessions[TestSessionId]?.messages).toHaveLength(1);
  expect(state.sessions[TestSessionId]?.runs[0]).toMatchObject({
    requestId: TestRequestId,
    status: "failed",
  });
});
