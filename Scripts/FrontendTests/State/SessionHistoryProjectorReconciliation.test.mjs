import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestRequestId, TestSessionId } from "./sessionProjectorTestUtils.mjs";

test("terminal run snapshots win when the event outbox has only persisted run.started", () => {
  const state = createTestState();
  applyEvent(
    state,
    createEvent(EventKinds.RunStarted, { input: "快速完成" }, { sessionId: TestSessionId, requestId: TestRequestId }),
  );
  applyEvent(state, createEvent(EventKinds.RunCompleted, {}, { sessionId: TestSessionId, requestId: TestRequestId }));
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
    createEvent(
      EventKinds.SessionHistorySteps,
      {
        sessionId: TestSessionId,
        runs: [
          {
            requestId: TestRequestId,
            input: "快速完成",
            startedAt: "2026-07-09T00:00:01.000Z",
            endedAt: "2026-07-09T00:00:02.000Z",
            status: "completed",
            traces: [{ step: 1, seq: 1, kind: "answer", status: "done", title: "回答完成" }],
          },
        ],
      },
      { sessionId: TestSessionId },
    ),
  );
  applyEvent(
    state,
    createEvent(
      EventKinds.SessionRunHistoryChunk,
      {
        sessionId: TestSessionId,
        events: [createEvent(EventKinds.RunStarted, { input: "快速完成" }, { sequence: 1 })],
      },
      { sessionId: TestSessionId },
    ),
  );
  applyEvent(
    state,
    createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }, { sessionId: TestSessionId }),
  );

  const run = state.sessions[TestSessionId]?.runs[0];
  expect(run?.status).toBe("completed");
  expect(run?.endedAt).toBe("2026-07-09T00:00:02.000Z");
  expect(run?.steps).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "answer", status: "done" })]));
  expect(run?.steps.some((step) => step.id.endsWith("history-interrupted"))).toBe(false);
});
