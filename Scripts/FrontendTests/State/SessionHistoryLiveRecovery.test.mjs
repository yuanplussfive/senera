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
