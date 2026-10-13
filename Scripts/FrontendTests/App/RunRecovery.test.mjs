import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useChatCommands } from "../../../Frontend/src/app/useChatCommands.ts";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { useStore } from "../../../Frontend/src/store/sessionStore.ts";
import {
  readSupersededFailureIds,
  isSupersededFailure,
} from "../../../Frontend/src/store/session/runRecoveryProjection.ts";
import { resetFrontendStore } from "../frontendStoreTestHarness.mjs";
import { createEvent, TestSessionId, TestRequestId } from "../State/sessionProjectorTestUtils.mjs";

beforeEach(() => resetFrontendStore());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function failedSession() {
  useStore.getState().ingest(createEvent(EventKinds.RunStarted, { input: "原请求" }));
  useStore
    .getState()
    .ingest(createEvent(EventKinds.RunFailed, { message: "模型超时", recoveryModes: ["retry", "continue"] }));
  return useStore.getState().sessions[TestSessionId].messages[0];
}

function commands(send = vi.fn(() => true)) {
  const options = {
    activeSessionId: TestSessionId,
    appendUserMessage: useStore.getState().appendUserMessage,
    lastSendRef: { current: null },
    registerSession: vi.fn(),
    send,
    serverKnownSessionIdsRef: { current: new Set([TestSessionId]) },
    status: "open",
  };
  const hook = renderHook(({ status }) => useChatCommands({ ...options, status }), {
    initialProps: { status: "open" },
  });
  return { ...hook, send };
}

test.each(["retry", "continue"])(
  "%s preserves the notice until the correlated server run starts and suppresses it permanently",
  (mode) => {
    const message = failedSession();
    const hook = commands();
    act(() => {
      hook.result.current[mode === "retry" ? "retryRun" : "continueRun"](message);
    });
    const request = hook.send.mock.calls[0][0];
    expect(request).toMatchObject({ type: "session.retry", failedRequestId: TestRequestId, recoveryMode: mode });
    let session = useStore.getState().sessions[TestSessionId];
    expect(session.runs[0].recoveryAttempt).toMatchObject({ status: "pending", mode, requestId: request.requestId });
    expect(readSupersededFailureIds(session).size).toBe(0);
    act(() => hook.result.current.retryRun(message));
    expect(hook.send).toHaveBeenCalledTimes(1);
    act(() =>
      useStore
        .getState()
        .ingest(
          createEvent(
            EventKinds.RunStarted,
            { input: "原请求", recovery: { mode, sourceRequestId: TestRequestId } },
            { requestId: request.requestId },
          ),
        ),
    );
    session = useStore.getState().sessions[TestSessionId];
    expect(session.runs[0].recoveryAttempt).toBeUndefined();
    expect(isSupersededFailure(message, readSupersededFailureIds(session))).toBe(true);
    expect(session.messages).toContainEqual(message);
    act(() => hook.result.current.retryRun(message));
    expect(hook.send).toHaveBeenCalledTimes(1);
  },
);

test.each([EventKinds.RunFailed, EventKinds.SessionBusy, EventKinds.RequestInvalid])(
  "%s rejects recovery at the original notice without losing its actions",
  (kind) => {
    const message = failedSession();
    const hook = commands();
    act(() => hook.result.current.retryRun(message));
    const request = hook.send.mock.calls[0][0];
    act(() =>
      useStore
        .getState()
        .ingest(
          createEvent(
            kind,
            { message: "仍有任务执行", rejectedRequestId: request.requestId, activeRequestId: "another" },
            { requestId: request.requestId },
          ),
        ),
    );
    const session = useStore.getState().sessions[TestSessionId];
    expect(session.runs[0].recoveryAttempt).toMatchObject({ status: "rejected", message: "仍有任务执行" });
    expect(session.runs[0].recoveryModes).toEqual(["retry", "continue"]);
    expect(readSupersededFailureIds(session).size).toBe(0);
    expect(session.messages).toHaveLength(1);
    act(() => hook.result.current.continueRun(message));
    expect(hook.send).toHaveBeenCalledTimes(2);
  },
);

test("send failure and disconnect restore recovery actions", () => {
  const message = failedSession();
  const send = vi.fn(() => false);
  const hook = commands(send);
  act(() => hook.result.current.retryRun(message));
  expect(useStore.getState().sessions[TestSessionId].runs[0].recoveryAttempt.status).toBe("rejected");
  send.mockReturnValue(true);
  act(() => hook.result.current.continueRun(message));
  hook.rerender({ status: "closed" });
  expect(useStore.getState().sessions[TestSessionId].runs[0].recoveryAttempt.status).toBe("rejected");
});

test("history provides actions for old failures with no action field and replays confirmed recovery lineage", () => {
  const events = [
    createEvent(EventKinds.RunStarted, { input: "原请求" }),
    createEvent(EventKinds.RunFailed, { message: "旧的供应商错误" }),
    createEvent(
      EventKinds.RunStarted,
      { input: "原请求", recovery: { mode: "retry", sourceRequestId: TestRequestId } },
      { requestId: "recovered" },
    ),
    createEvent(EventKinds.RunFailed, { message: "新的错误" }, { requestId: "recovered" }),
  ];
  const ingest = useStore.getState().ingest;
  ingest(createEvent(EventKinds.SessionHistoryStarted, { sessionId: TestSessionId, totalEntries: 0, messageCount: 0 }));
  ingest(
    createEvent(EventKinds.SessionHistorySteps, {
      sessionId: TestSessionId,
      runs: [TestRequestId, "recovered"].map((requestId) => ({
        requestId,
        input: "原请求",
        startedAt: "2026-07-09T00:00:00Z",
        status: "failed",
        recoveryModes: ["retry", "continue"],
        traces: [],
      })),
    }),
  );
  ingest(createEvent(EventKinds.SessionRunHistoryChunk, { sessionId: TestSessionId, events }));
  ingest(createEvent(EventKinds.SessionHistoryCompleted, { sessionId: TestSessionId }));
  const session = useStore.getState().sessions[TestSessionId];
  expect(session.runs.every((run) => run.recoveryModes?.length === 2)).toBe(true);
  expect(readSupersededFailureIds(session)).toEqual(new Set([TestRequestId]));
  const visibleFailures = session.messages.filter(
    (message) => !isSupersededFailure(message, readSupersededFailureIds(session)),
  );
  expect(visibleFailures).toHaveLength(1);
  expect(visibleFailures[0].requestId).toBe("recovered");
});
