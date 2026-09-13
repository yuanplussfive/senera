import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { advanceHistoryHydration, applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestSessionId, TestTimestamp } from "./sessionProjectorTestUtils.mjs";

test("history replay renders the optional recent preview before completion", () => {
  const state = createTestState();
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryStarted, {
      sessionId: TestSessionId,
      totalEntries: 100,
      messageCount: 2,
    }),
  );

  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryChunk, {
      sessionId: TestSessionId,
      preview: true,
      entries: [
        {
          entry: {
            id: "preview-user",
            requestId: "preview-request",
            timestamp: "2026-07-09T00:00:01.000Z",
            kind: "user.message",
            content: "最近的问题",
          },
        },
        {
          entry: {
            id: "preview-assistant",
            requestId: "preview-request",
            timestamp: "2026-07-09T00:00:02.000Z",
            kind: "assistant.decision",
            xml: "最近的回复",
            metadata: { run: { modelProvider: { id: "model" } } },
          },
          visible: { kind: "final_answer", text: "最近的回复" },
        },
      ],
    }),
  );

  expect(state.sessions[TestSessionId]?.messages.map((message) => message.content)).toEqual([
    "最近的问题",
    "最近的回复",
  ]);
  expect(state.historyLoadingIds[TestSessionId]).toBe(true);
});

test("large history completion yields to scheduled hydration without losing entries", () => {
  const state = createTestState();
  const entries = Array.from({ length: 520 }, (_, index) => ({
    entry: {
      id: `large-entry-${index}`,
      requestId: `large-request-${index}`,
      timestamp: `2026-07-09T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
      kind: "user.message",
      content: `消息 ${index}`,
    },
  }));

  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryStarted, {
      sessionId: TestSessionId,
      totalEntries: entries.length,
      messageCount: entries.length,
    }),
  );
  applyEvent(state, createEvent(EventKinds.SessionHistoryChunk, { sessionId: TestSessionId, entries }));
  applyEvent(state, createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }));

  expect(state.historyLoadingIds[TestSessionId]).toBe(false);
  expect(state.historyLoadedIds[TestSessionId]).toBeUndefined();
  expect(state.historyHydration[TestSessionId]).toBeDefined();

  let pending = true;
  while (pending) pending = advanceHistoryHydration(state, TestSessionId);

  expect(state.historyHydration[TestSessionId]).toBeUndefined();
  expect(state.historyLoadedIds[TestSessionId]).toBe(true);
  expect(state.sessions[TestSessionId]?.messages).toHaveLength(entries.length);
});

test("background hydration does not overwrite a live request started after replay", () => {
  const state = createTestState({
    sessions: {
      [TestSessionId]: {
        sessionId: TestSessionId,
        title: "History",
        status: "ready",
        createdAt: TestTimestamp,
        updatedAt: TestTimestamp,
        entryCount: 520,
        messageCount: 520,
        messages: [],
        runs: [],
      },
    },
  });
  const entries = Array.from({ length: 520 }, (_, index) => ({
    entry: {
      id: `history-entry-${index}`,
      requestId: `history-request-${index}`,
      timestamp: `2026-07-09T00:01:${String(index).padStart(3, "0")}Z`,
      kind: "user.message",
      content: `历史消息 ${index}`,
    },
  }));

  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryStarted, {
      sessionId: TestSessionId,
      totalEntries: entries.length,
      messageCount: entries.length,
    }),
  );
  applyEvent(state, createEvent(EventKinds.SessionHistoryChunk, { sessionId: TestSessionId, entries }));
  applyEvent(state, createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }));

  const liveRequestId = "live-request-after-replay";
  const liveSession = state.sessions[TestSessionId];
  liveSession.activeRequestId = liveRequestId;
  liveSession.runs.push({
    requestId: liveRequestId,
    revision: 0,
    startedAt: "2026-07-09T00:02:00.000Z",
    status: "running",
    outputState: "pending",
    input: "继续处理",
    steps: [],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    expectedOutputMode: "unknown",
    decisionMode: "none",
    approvals: [],
    interactionInputs: [],
  });

  while (advanceHistoryHydration(state, TestSessionId)) {
    // Drain the same bounded work slices used by the browser scheduler.
  }

  expect(state.sessions[TestSessionId]?.activeRequestId).toBe(liveRequestId);
  expect(state.sessions[TestSessionId]?.runs.find((run) => run.requestId === liveRequestId)?.status).toBe("running");
});
