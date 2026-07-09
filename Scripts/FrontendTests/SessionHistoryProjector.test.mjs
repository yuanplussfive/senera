import { expect, test } from "vitest";
import { EventKinds } from "../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../Frontend/src/store/session/sessionProjector.ts";
import {
  createEvent,
  createTestState,
  TestRequestId,
  TestSessionId,
} from "./sessionProjectorTestUtils.mjs";

test("history replay buffers chunks and materializes messages on completion", () => {
  const state = createTestState();
  applyEvent(state, createEvent(EventKinds.SessionSnapshot, {
    sessionId: TestSessionId,
    status: "ready",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    entryCount: 0,
    messageCount: 0,
    turnCount: 0,
  }, { requestId: undefined, phase: "session" }));

  applyEvent(state, createEvent(EventKinds.SessionHistoryStarted, {
    sessionId: TestSessionId,
    totalEntries: 2,
    messageCount: 2,
  }, { requestId: undefined, sequence: 2, phase: "session" }));

  const userEntry = {
    id: "entry_user",
    requestId: TestRequestId,
    timestamp: "2026-07-09T00:00:01.000Z",
    kind: "user.message",
    content: "你好",
  };
  const assistantEntry = {
    id: "entry_assistant",
    requestId: TestRequestId,
    timestamp: "2026-07-09T00:00:02.000Z",
    kind: "assistant.decision",
    xml: "你好，我在。",
    metadata: {
      run: {
        modelProvider: {
          id: "model",
          kind: "OpenAICompatible",
          endpoint: "ChatCompletions",
          baseUrl: "https://example.invalid/v1",
          model: "test-model",
        },
      },
    },
  };

  applyEvent(state, createEvent(EventKinds.SessionHistoryChunk, {
    sessionId: TestSessionId,
    entries: [
      { entry: userEntry },
      { entry: assistantEntry, visible: { kind: "final_answer", text: "你好，我在。" } },
    ],
  }, { requestId: undefined, sequence: 3, phase: "session" }));

  expect(state.sessions[TestSessionId]?.messages.length).toBe(0);
  expect(state.historyReplayBuffers[TestSessionId]?.length).toBe(2);

  applyEvent(state, createEvent(EventKinds.SessionHistorySteps, {
    sessionId: TestSessionId,
    runs: [{
      requestId: TestRequestId,
      input: "你好",
      startedAt: "2026-07-09T00:00:01.000Z",
      endedAt: "2026-07-09T00:00:02.000Z",
      status: "completed",
      traces: [{
        step: 1,
        seq: 0,
        kind: "answer",
        decisionKind: "final_answer",
        status: "done",
      }],
    }],
  }, { requestId: undefined, sequence: 4, phase: "session" }));

  applyEvent(state, createEvent(EventKinds.SessionHistoryCompleted, {
    sessionId: TestSessionId,
  }, { requestId: undefined, sequence: 5, phase: "session" }));

  const session = state.sessions[TestSessionId];
  expect(session).toBeTruthy();
  expect(session.messages.map((message) => [message.role, message.content])).toEqual([
    ["user", "你好"],
    ["assistant", "你好，我在。"],
  ]);
  expect(session.runs.length).toBe(1);
  expect(session.runs[0]?.requestId).toBe(TestRequestId);
  expect(session.runs[0]?.steps[0]?.kind).toBe("answer");
  expect(state.historyLoadedIds[TestSessionId]).toBe(true);
  expect(state.historyLoadingIds[TestSessionId]).toBe(false);
  expect(state.historyReplayBuffers[TestSessionId]).toBe(undefined);
});
