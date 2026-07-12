import React, { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  readRecoveryPollingKey,
  shouldRequestActiveSessionHistory,
  useSessionHistoryRecovery,
} from "../../../Frontend/src/app/useSessionHistoryRecovery.ts";
import { useStore } from "../../../Frontend/src/store/sessionStore.ts";
import { clearTestToastCalls, readTestToastCalls } from "../mocks/sonner.mjs";
import { resetFrontendStore } from "../frontendStoreTestHarness.mjs";

beforeEach(() => {
  resetFrontendStore();
  clearTestToastCalls();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

test.each([
  ["open active session without history", historyRequestState(), true],
  ["closed socket", historyRequestState({ status: "closed" }), false],
  ["already loaded", historyRequestState({ historyLoadedIds: { active: true } }), false],
  ["already loading", historyRequestState({ historyLoadingIds: { active: true } }), false],
  ["missing on server", historyRequestState({ missingOnServerIds: { active: true } }), false],
  ["no active session", historyRequestState({ activeSessionId: null }), false],
])("shouldRequestActiveSessionHistory returns %s = %s", (_label, input, expected) => {
  expect(shouldRequestActiveSessionHistory(input)).toBe(expected);
});

test("readRecoveryPollingKey retains only unfinished history runs in stable order", () => {
  const key = readRecoveryPollingKey({
    historyLoadingIds: { beta: true },
    sessions: {
      beta: session("beta", [recoveryRun("run-beta", 2)]),
      alpha: session("alpha", [recoveryRun("run-alpha", 1), completedRun("done")]),
      ignored: session("ignored", [completedRun("complete")]),
    },
  });

  expect(key.split("\u0000")).toEqual([
    "alpha\u0001run-alpha\u00011\u0001idle",
    "beta\u0001run-beta\u00012\u0001loading",
  ]);
});

test("automatically loads the active session exactly once after the socket opens", () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  useStore.setState({
    sessions: { active: session("active") },
    sessionOrder: ["active"],
    activeSessionId: "active",
  });

  render(React.createElement(HistoryRecoveryHarness, { activeSessionId: "active", handleRef, send, status: "open" }));

  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({ type: "session.history", sessionId: "active", refresh: undefined });
  expect(useStore.getState().historyLoadingIds.active).toBe(true);

  act(() => {
    handleRef.current.requestSessionHistory("active");
  });
  expect(send).toHaveBeenCalledTimes(2);
});

test("marks history recovery as failed when the socket cannot accept the request", () => {
  const send = vi.fn(() => false);
  const handleRef = { current: null };
  render(React.createElement(HistoryRecoveryHarness, { activeSessionId: null, handleRef, send, status: "closed" }));

  let result = true;
  act(() => {
    result = handleRef.current.requestSessionHistory("disconnected", { refresh: true });
  });

  expect(result).toBe(false);
  expect(send).toHaveBeenCalledWith({ type: "session.history", sessionId: "disconnected", refresh: true });
  expect(useStore.getState().historyLoadingIds.disconnected).toBe(false);
  expect(useStore.getState().historyFailedIds.disconnected).toBe(true);
  expect(readTestToastCalls()).toEqual([expect.objectContaining({ variant: "error" })]);
});

test("retries unfinished history runs with increasing bounded polling delays", async () => {
  vi.useFakeTimers();
  const send = vi.fn(() => true);
  const sessionId = "recovering";
  useStore.setState({
    sessions: { [sessionId]: session(sessionId, [recoveryRun("history-run", 4)]) },
    sessionOrder: [sessionId],
  });

  render(
    React.createElement(HistoryRecoveryHarness, {
      activeSessionId: null,
      handleRef: { current: null },
      send,
      status: "open",
    }),
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_500);
  });
  expect(send).toHaveBeenLastCalledWith({ type: "session.history", sessionId, refresh: true });

  act(() => {
    useStore.getState().markHistoryLoadFailed(sessionId);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith({ type: "session.history", sessionId, refresh: true });
});

function HistoryRecoveryHarness({ activeSessionId, handleRef, send, status }) {
  const handle = useSessionHistoryRecovery({ activeSessionId, send, status });
  useEffect(() => {
    handleRef.current = handle;
  }, [handle, handleRef]);
  return null;
}

function historyRequestState(overrides = {}) {
  return {
    activeSessionId: "active",
    historyLoadedIds: {},
    historyLoadingIds: {},
    missingOnServerIds: {},
    status: "open",
    ...overrides,
  };
}

function session(sessionId, runs = []) {
  return {
    sessionId,
    title: sessionId,
    status: "ready",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    entryCount: 0,
    messageCount: 0,
    messages: [],
    runs,
  };
}

function recoveryRun(requestId, revision) {
  return {
    requestId,
    revision,
    startedAt: "2026-07-12T00:00:00.000Z",
    status: "running",
    input: "Recover history",
    steps: [],
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    expectedOutputMode: "unknown",
    decisionMode: "none",
    pendingToolArgsByName: {},
    recoverySource: "history",
  };
}

function completedRun(requestId) {
  return {
    ...recoveryRun(requestId, 1),
    status: "completed",
    recoverySource: undefined,
  };
}
