import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestSessionId, TestTimestamp } from "./sessionProjectorTestUtils.mjs";

test("commits a window atomically, retains new live work and attachments, and preserves catalog totals", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.RunStarted, { input: "old" }, { requestId: "old", eventId: "old-start" }));
  applyEvent(state, createEvent(EventKinds.RunCompleted, {}, { requestId: "old", eventId: "old-end" }));
  state.runHistoryDetailStates[TestSessionId] = { old: { status: "loaded" } };
  startWindow(state, ["current"]);
  expect(state.sessions[TestSessionId].runs.map((run) => run.requestId)).toEqual(["old"]);
  const attachment = { resourceUri: "senera://resource/AbCd12", name: "image.png", mime: "image/png", size: 42 };
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryChunk, {
      sessionId: TestSessionId,
      entries: [
        {
          entry: {
            id: "current:user",
            requestId: "current",
            timestamp: TestTimestamp,
            kind: "user.message",
            content: "",
            attachments: [attachment],
          },
        },
      ],
    }),
  );
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistorySteps, { sessionId: TestSessionId, runs: [snapshot("current")] }),
  );
  applyEvent(
    state,
    createEvent(EventKinds.RunStarted, { input: "new live request" }, { requestId: "live", eventId: "live-start" }),
  );
  complete(state);
  expect(state.sessions[TestSessionId].runs.map((run) => run.requestId).sort()).toEqual(["current", "live"]);
  expect(state.sessions[TestSessionId].activeRequestId).toBe("live");
  expect(state.sessions[TestSessionId].messages.find((message) => message.requestId === "current").attachments).toEqual(
    [attachment],
  );
  expect(state.sessions[TestSessionId].messageCount).toBe(100);
  expect(state.runHistoryDetailStates[TestSessionId].old).toBeUndefined();
  expect(state.processedEventIds["old-start"]).toBeUndefined();
  expect(state.processedEventIds["live-start"]).toBe(TestSessionId);
});

test("an evicted failed run reopens with its original result events and can be evicted again", () => {
  const state = createTestState();
  const requestId = "failed";
  const events = [
    createEvent(
      EventKinds.ToolCallStarted,
      { index: 0, toolName: "WorkspaceRead", callId: "read", arguments: { path: "missing.yaml" } },
      { requestId, eventId: "failed-start" },
    ),
    createEvent(
      EventKinds.ToolCallResultDetail,
      { detailId: "detail", index: 0, toolName: "WorkspaceRead", callId: "read", value: { exists: false } },
      { requestId, eventId: "failed-result" },
    ),
    createEvent(
      EventKinds.ToolCallFailed,
      { index: 0, toolName: "WorkspaceRead", callId: "read", message: "Missing file" },
      { requestId, eventId: "failed-error" },
    ),
  ];
  const loadFailure = (mode) => {
    startWindow(state, [requestId], mode);
    applyEvent(
      state,
      createEvent(EventKinds.SessionHistorySteps, { sessionId: TestSessionId, runs: [snapshot(requestId, "failed")] }),
    );
    applyEvent(state, createEvent(EventKinds.SessionRunHistoryChunk, { sessionId: TestSessionId, events }));
    complete(state);
  };
  loadFailure("replace");
  startWindow(state, ["current"]);
  complete(state);
  expect(state.sessions[TestSessionId].runs).toHaveLength(0);
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionRunHistoryDetail,
      { sessionId: TestSessionId, requestId, events: [], complete: true },
      { requestId },
    ),
  );
  expect(state.runHistoryDetailStates[TestSessionId]?.[requestId]).toBeUndefined();
  loadFailure("prepend");
  const step = state.sessions[TestSessionId].runs[0].steps.find((item) => item.callId === "read");
  expect(step).toMatchObject({
    status: "failed",
    toolArgs: { path: "missing.yaml" },
    toolResult: { exists: false },
    toolErrorMessage: "Missing file",
  });
  expect(state.sessions[TestSessionId].historyWindow.mode).toBe("prepend");
  startWindow(state, ["current"]);
  complete(state);
  expect(state.sessions[TestSessionId].runs).toHaveLength(0);
});

test("a window refresh failure leaves the previous messages and results usable", () => {
  const state = createTestState();
  startWindow(state, ["current"]);
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistorySteps, { sessionId: TestSessionId, runs: [snapshot("current")] }),
  );
  complete(state);
  startWindow(state, ["older"], "prepend");
  applyEvent(
    state,
    createEvent(EventKinds.RunFailed, { message: "History read failed" }, { requestId: "history-request" }),
  );
  expect(state.sessions[TestSessionId].runs.map((run) => run.requestId)).toEqual(["current"]);
  expect(state.sessions[TestSessionId].pendingHistoryWindow).toBeUndefined();
  expect(state.historyFailedIds[TestSessionId]).toBe(true);
});

test("any Pi compaction invalidates its transcript window", () => {
  const state = createTestState();
  startWindow(state, []);
  complete(state);
  const session = state.sessions[TestSessionId];
  applyEvent(state, createEvent(EventKinds.SessionCompacted, { sessionId: TestSessionId, tokensBefore: 100 }));
  expect(session.historyInvalidated).toBe(true);
});

function startWindow(state, requestIds, mode = "replace") {
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryStarted, {
      sessionId: TestSessionId,
      totalEntries: 100,
      messageCount: 100,
      refresh: true,
      window: { mode, requestIds, boundaryId: "compaction", before: "first" },
    }),
  );
}

function complete(state) {
  applyEvent(state, createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }));
}

function snapshot(requestId, status = "completed") {
  return { requestId, input: requestId, startedAt: TestTimestamp, endedAt: TestTimestamp, status, traces: [] };
}
