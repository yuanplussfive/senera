// @vitest-environment jsdom

import React, { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { useSessionNotFoundRecovery } from "../../../Frontend/src/app/useSessionNotFoundRecovery.ts";
import { useWorkflowNavigation } from "../../../Frontend/src/app/useWorkflowNavigation.ts";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { useStore } from "../../../Frontend/src/store/sessionStore.ts";
import { clearTestToastCalls, readTestToastCalls } from "../mocks/sonner.mjs";
import { resetFrontendStore } from "../frontendStoreTestHarness.mjs";

beforeEach(() => {
  resetFrontendStore();
  clearTestToastCalls();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("atomically recreates a missing session while replaying the last message exactly once", () => {
  const send = vi.fn(() => true);
  const ingest = vi.fn();
  const knownSessions = { current: new Set(["session-missing"]) };
  const lastSentMessage = {
    current: {
      sessionId: "session-missing",
      requestId: "request-original",
      input: "Continue the task",
      attachments: [
        { uploadUri: "senera://upload/source", name: "source.ts", mime: "text/plain", size: 10, status: "uploaded" },
      ],
      modelProviderId: "primary",
      queueMode: "enqueue",
    },
  };
  const handleRef = { current: null };

  render(
    React.createElement(SessionNotFoundRecoveryHarness, {
      handleRef,
      ingest,
      lastSendRef: lastSentMessage,
      sendRef: { current: send },
      serverKnownSessionIdsRef: knownSessions,
    }),
  );

  let handled = false;
  act(() => {
    handled = handleRef.current.handleSessionNotFound(sessionNotFoundEvent("session.message", "session-missing"));
  });

  expect(handled).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({
    type: "session.message",
    sessionId: "session-missing",
    requestId: "request-original",
    input: "Continue the task",
    attachments: lastSentMessage.current.attachments,
    modelProviderId: "primary",
    disposition: "create_if_missing",
    queueMode: "enqueue",
  });
  expect(knownSessions.current.has("session-missing")).toBe(true);
  expect(ingest).not.toHaveBeenCalled();
  expect(readTestToastCalls()).toContainEqual(expect.objectContaining({ variant: "message" }));
});

test("keeps history failure in the projector and refreshes the catalog for a missing close", () => {
  const send = vi.fn(() => true);
  const ingest = vi.fn();
  const knownSessions = { current: new Set(["history", "closing"]) };
  const handleRef = { current: null };
  render(
    React.createElement(SessionNotFoundRecoveryHarness, {
      handleRef,
      ingest,
      lastSendRef: { current: null },
      sendRef: { current: send },
      serverKnownSessionIdsRef: knownSessions,
    }),
  );

  act(() => {
    expect(handleRef.current.handleSessionNotFound(sessionNotFoundEvent("session.history", "history"))).toBe(true);
    expect(handleRef.current.handleSessionNotFound(sessionNotFoundEvent("session.close", "closing"))).toBe(true);
  });

  expect(ingest).toHaveBeenCalledWith(sessionNotFoundEvent("session.history", "history"));
  expect(send).toHaveBeenCalledWith({ type: "session.list" });
  expect(knownSessions.current.has("history")).toBe(false);
  expect(knownSessions.current.has("closing")).toBe(false);
  expect(readTestToastCalls().map((call) => call.variant)).toEqual(["warning", "message"]);
});

test("marks a missing fork source without replaying the last message as an empty session", () => {
  const send = vi.fn(() => true);
  const ingest = vi.fn();
  const knownSessions = { current: new Set(["fork-source"]) };
  const event = sessionNotFoundEvent("session.fork", "fork-source");
  const handleRef = { current: null };
  render(
    React.createElement(SessionNotFoundRecoveryHarness, {
      handleRef,
      ingest,
      lastSendRef: {
        current: {
          sessionId: "fork-source",
          requestId: "request-last",
          input: "This must not be replayed",
        },
      },
      sendRef: { current: send },
      serverKnownSessionIdsRef: knownSessions,
    }),
  );

  act(() => {
    expect(handleRef.current.handleSessionNotFound(event)).toBe(true);
  });

  expect(send).not.toHaveBeenCalled();
  expect(ingest).toHaveBeenCalledWith(event);
  expect(knownSessions.current.has("fork-source")).toBe(false);
  expect(readTestToastCalls()).toContainEqual(
    expect.objectContaining({ variant: "warning", title: frontendMessage("session.forkSourceMissingTitle") }),
  );
});

test("opens the workflow drawer for a run referenced by the selected message", () => {
  const setWorkflowDrawerOpen = vi.fn();
  const handleRef = { current: null };
  resetFrontendStore({
    activeSessionId: "session-a",
    sessionOrder: ["session-a"],
    sessions: { "session-a": sessionWithRun("session-a", "request-a") },
  });
  render(
    React.createElement(WorkflowNavigationHarness, {
      activeSessionId: "session-a",
      handleRef,
      hasPersistentWorkflowPanel: false,
      setWorkflowDrawerOpen,
    }),
  );

  act(() => {
    handleRef.current.viewMessageWorkflow({ requestId: "request-a" });
  });

  expect(useStore.getState().viewedRunIdBySession).toEqual({ "session-a": "request-a" });
  expect(setWorkflowDrawerOpen).toHaveBeenCalledWith(true);
});

test("expands the persistent panel and reports a missing workflow without changing selection", () => {
  const setWorkflowDrawerOpen = vi.fn();
  const handleRef = { current: null };
  resetFrontendStore({
    activeSessionId: "session-a",
    rightPanelCollapsed: true,
    sessionOrder: ["session-a"],
    sessions: { "session-a": sessionWithRun("session-a", "request-a") },
  });
  render(
    React.createElement(WorkflowNavigationHarness, {
      activeSessionId: "session-a",
      handleRef,
      hasPersistentWorkflowPanel: true,
      setWorkflowDrawerOpen,
    }),
  );

  act(() => {
    handleRef.current.viewMessageWorkflow({ requestId: "request-a" });
  });
  expect(useStore.getState().rightPanelCollapsed).toBe(false);

  act(() => {
    handleRef.current.viewMessageWorkflow({ requestId: "missing-request" });
  });
  expect(useStore.getState().viewedRunIdBySession).toEqual({ "session-a": "request-a" });
  expect(setWorkflowDrawerOpen).not.toHaveBeenCalled();
  expect(readTestToastCalls()).toContainEqual(expect.objectContaining({ variant: "info" }));
});

function SessionNotFoundRecoveryHarness({ handleRef, ...options }) {
  const handle = useSessionNotFoundRecovery(options);
  useEffect(() => {
    handleRef.current = handle;
  }, [handle, handleRef]);
  return null;
}

function WorkflowNavigationHarness({ handleRef, ...options }) {
  const handle = useWorkflowNavigation(options);
  useEffect(() => {
    handleRef.current = handle;
  }, [handle, handleRef]);
  return null;
}

function sessionNotFoundEvent(operation, sessionId) {
  return {
    channel: "agent.event",
    kind: EventKinds.SessionNotFound,
    layer: "session",
    phase: "event",
    sequence: 1,
    timestamp: "2026-07-12T00:00:00.000Z",
    sessionId,
    data: { operation, sessionId, message: "missing" },
  };
}

function sessionWithRun(sessionId, requestId) {
  return {
    sessionId,
    title: "Session",
    status: "ready",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    entryCount: 0,
    messageCount: 0,
    messages: [],
    runs: [
      {
        requestId,
        revision: 0,
        startedAt: "2026-07-12T00:00:00.000Z",
        status: "completed",
        input: "Workflow input",
        steps: [],
        streamingRaw: "",
        xmlPreview: "",
        visibleText: "",
        displayText: "",
        visibleKind: "unknown",
        expectedOutputMode: "open",
        decisionMode: "none",
        pendingToolArgsByName: {},
      },
    ],
  };
}
