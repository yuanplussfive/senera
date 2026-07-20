import React, { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useChatCommands } from "../../../Frontend/src/app/useChatCommands.ts";
import { useSessionCommands } from "../../../Frontend/src/app/useSessionCommands.ts";
import { frontendMessage } from "../../../Frontend/src/i18n/frontendMessageCatalog.ts";
import { useStore } from "../../../Frontend/src/store/sessionStore.ts";
import { clearTestToastCalls, readTestToastCalls } from "../mocks/sonner.mjs";
import { installMemoryLocalStorage, registerTestSession, resetFrontendStore } from "../frontendStoreTestHarness.mjs";

beforeEach(() => {
  installMemoryLocalStorage();
  clearTestToastCalls();
  resetFrontendStore();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("useChatCommands creates a missing session and sends its first message as one transaction", () => {
  useStore.setState({ selectedModelProviderId: "model-primary" });
  const send = vi.fn(() => true);
  const serverKnownSessionIdsRef = { current: new Set() };
  const lastSendRef = { current: null };
  const handleRef = { current: null };
  renderChatCommands({
    activeSessionId: null,
    handleRef,
    lastSendRef,
    send,
    serverKnownSessionIdsRef,
  });

  act(() => handleRef.current.sendMessage("Inspect the workspace"));

  expect(send).toHaveBeenCalledTimes(1);
  const messageRequest = send.mock.calls[0][0];
  expect(messageRequest).toMatchObject({
    type: "session.message",
    sessionId: expect.any(String),
    requestId: expect.any(String),
    modelProviderId: "model-primary",
    input: "Inspect the workspace",
    disposition: "create_if_missing",
  });
  expect(serverKnownSessionIdsRef.current).toContain(messageRequest.sessionId);
  expect(lastSendRef.current).toMatchObject({
    sessionId: messageRequest.sessionId,
    requestId: messageRequest.requestId,
    input: "Inspect the workspace",
  });
  expect(useStore.getState().sessions[messageRequest.sessionId]).toMatchObject({
    title: "Inspect the workspace",
    messages: [expect.objectContaining({ content: "Inspect the workspace", role: "user" })],
  });
});

test("useChatCommands blocks sends while history is recovering without mutating state", () => {
  const sessionId = "session-recovering";
  registerTestSession(sessionId);
  useStore.setState({ historyLoadingIds: { [sessionId]: true } });
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  renderChatCommands({ activeSessionId: sessionId, handleRef, send });

  act(() => handleRef.current.sendMessage("Do not send yet"));

  expect(send).not.toHaveBeenCalled();
  expect(useStore.getState().sessions[sessionId].messages).toHaveLength(0);
  expect(readTestToastCalls()).toContainEqual(
    expect.objectContaining({
      variant: "warning",
      title: frontendMessage("chat.historyRecovering"),
    }),
  );
});

test("useChatCommands leaves local history unchanged when regenerate delivery fails", () => {
  const sessionId = "session-a";
  const requestId = "request-a";
  registerTestSession(sessionId);
  useStore.getState().appendUserMessage(sessionId, requestId, "retry input");
  const send = vi.fn(() => false);
  const handleRef = { current: null };
  renderChatCommands({
    activeSessionId: sessionId,
    handleRef,
    send,
  });
  const assistantMessage = {
    id: "assistant-a",
    role: "assistant",
    content: "answer",
    createdAt: "2026-07-11T00:00:00.000Z",
    requestId,
  };

  act(() => handleRef.current.regenerateMessage(assistantMessage));

  expect(useStore.getState().sessions[sessionId].messages).toHaveLength(1);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "session.regenerate",
      sessionId,
      fromRequestId: requestId,
      input: "retry input",
    }),
  );
  expect(readTestToastCalls()).toContainEqual(
    expect.objectContaining({
      variant: "error",
      title: frontendMessage("chat.operationDisconnected"),
    }),
  );
});

test("useChatCommands regenerates from the matching user message immediately with one request", () => {
  const sessionId = "session-edit";
  const requestId = "request-original";
  registerTestSession(sessionId);
  useStore.getState().appendUserMessage(sessionId, requestId, "Original input");
  useStore.setState({ selectedModelProviderId: "model-edits" });
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  renderChatCommands({
    activeSessionId: sessionId,
    handleRef,
    send,
  });
  const assistantMessage = {
    id: "assistant-message",
    role: "assistant",
    content: "Original answer",
    createdAt: "2026-07-11T00:00:00.000Z",
    requestId,
  };

  act(() => handleRef.current.regenerateMessage(assistantMessage));
  expect(send).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "session.regenerate",
      sessionId,
      fromRequestId: requestId,
      input: "Original input",
      modelProviderId: "model-edits",
    }),
  );
  expect(useStore.getState().sessions[sessionId].messages).toEqual([
    expect.objectContaining({ role: "user", content: "Original input" }),
  ]);
  expect(useStore.getState().sessions[sessionId].runs).toHaveLength(1);
  expect(send.mock.calls.map(([request]) => request.type)).toEqual(["session.regenerate"]);
});

test("useChatCommands requests a non-destructive fork without creating a local placeholder", () => {
  const sessionId = "session-source";
  registerTestSession(sessionId);
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  renderChatCommands({ activeSessionId: sessionId, handleRef, send });
  const message = {
    id: "assistant-a",
    role: "assistant",
    content: "Answer A",
    createdAt: "2026-07-17T00:00:00.000Z",
    requestId: "request-a",
  };

  act(() => handleRef.current.forkFromMessage(message));

  expect(send).toHaveBeenCalledWith({
    type: "session.fork",
    sourceSessionId: sessionId,
    sessionId: expect.any(String),
    throughRequestId: "request-a",
  });
  expect(useStore.getState().sessionOrder).toEqual([sessionId]);
  expect(useStore.getState().activeSessionId).toBe(sessionId);
});

test("useChatCommands validates and applies edited user messages through regeneration", () => {
  const sessionId = "session-edit";
  const requestId = "request-original";
  registerTestSession(sessionId);
  useStore.getState().appendUserMessage(sessionId, requestId, "Original input");
  useStore.setState({ selectedModelProviderId: "model-edits" });
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  renderChatCommands({
    activeSessionId: sessionId,
    handleRef,
    send,
  });
  const userMessage = useStore.getState().sessions[sessionId].messages[0];

  act(() => handleRef.current.editUserMessage(userMessage, "   "));
  expect(readTestToastCalls()).toContainEqual(
    expect.objectContaining({
      variant: "error",
      title: frontendMessage("chat.contentRequired"),
    }),
  );
  expect(send).not.toHaveBeenCalled();

  act(() => handleRef.current.editUserMessage(userMessage, "  Updated input  "));

  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "session.regenerate",
      sessionId,
      fromRequestId: requestId,
      input: "Updated input",
      modelProviderId: "model-edits",
    }),
  );
  expect(useStore.getState().sessions[sessionId].messages).toEqual([
    expect.objectContaining({ role: "user", content: "Updated input" }),
  ]);
  expect(useStore.getState().sessions[sessionId].runs).toHaveLength(1);
});

test("useSessionCommands creates, renames, and synchronizes sessions only after successful delivery", () => {
  const send = vi.fn(() => true);
  const serverKnownSessionIdsRef = { current: new Set() };
  const handleRef = { current: null };
  renderSessionCommands({
    handleRef,
    defaultModelProviderId: "model-session",
    send,
    serverKnownSessionIdsRef,
    status: "open",
  });

  act(() => handleRef.current.createSession());
  const created = send.mock.calls[0][0];
  expect(created).toMatchObject({
    type: "session.create",
    sessionId: expect.any(String),
  });
  expect(serverKnownSessionIdsRef.current).toContain(created.sessionId);
  expect(useStore.getState().activeSessionId).toBe(created.sessionId);

  act(() => handleRef.current.renameSession(created.sessionId, "  Renamed session  "));
  expect(useStore.getState().sessions[created.sessionId].title).toBe("Renamed session");
  expect(send).toHaveBeenLastCalledWith({
    type: "session.rename",
    sessionId: created.sessionId,
    title: "Renamed session",
  });
});

test("useSessionCommands keeps failed bulk deletions and reports the partial result", () => {
  registerTestSession("session-a");
  registerTestSession("session-b");
  const serverKnownSessionIdsRef = { current: new Set(["session-a", "session-b"]) };
  const send = vi.fn((request) => request.sessionId !== "session-b");
  const handleRef = { current: null };
  renderSessionCommands({ handleRef, send, serverKnownSessionIdsRef, status: "open" });

  act(() => handleRef.current.closeSessions(["session-a", "session-a", "session-b", ""]));

  expect(send.mock.calls.map(([request]) => request.sessionId)).toEqual(["session-a", "session-b"]);
  expect(useStore.getState().sessions["session-a"]).toBeUndefined();
  expect(useStore.getState().sessions["session-b"]).toBeDefined();
  expect(serverKnownSessionIdsRef.current).toEqual(new Set(["session-b"]));
  expect(readTestToastCalls()).toContainEqual(
    expect.objectContaining({
      variant: "error",
      title: frontendMessage("session.bulkDeletePartialFailed", { count: 1 }),
    }),
  );
});

test("useSessionCommands updates the local profile offline and defers network synchronization", () => {
  const send = vi.fn(() => true);
  const handleRef = { current: null };
  renderSessionCommands({ handleRef, send, status: "closed" });

  act(() =>
    handleRef.current.updateUserProfile({
      name: "Offline user",
      avatarDataUrl: null,
    }),
  );

  expect(send).not.toHaveBeenCalled();
  expect(useStore.getState().userProfile).toMatchObject({
    name: "Offline user",
    avatarDataUrl: null,
    syncState: "pending",
  });
});

function renderChatCommands({
  activeSessionId,
  handleRef,
  lastSendRef = { current: null },
  send,
  serverKnownSessionIdsRef = { current: new Set([activeSessionId].filter(Boolean)) },
}) {
  return render(
    React.createElement(ChatCommandsHarness, {
      activeSessionId,
      appendUserMessage: useStore.getState().appendUserMessage,
      handleRef,
      lastSendRef,
      registerSession: useStore.getState().registerCreatingSession,
      send,
      serverKnownSessionIdsRef,
      status: "open",
    }),
  );
}

function ChatCommandsHarness({ handleRef, ...options }) {
  const handle = useChatCommands(options);
  useEffect(() => {
    handleRef.current = handle;
  }, [handle, handleRef]);
  return null;
}

function renderSessionCommands({
  handleRef,
  defaultModelProviderId = null,
  send,
  serverKnownSessionIdsRef = { current: new Set() },
  status,
}) {
  return render(
    React.createElement(SessionCommandsHarness, {
      handleRef,
      defaultModelProviderId,
      send,
      serverKnownSessionIdsRef,
      status,
    }),
  );
}

function SessionCommandsHarness({ handleRef, ...options }) {
  const handle = useSessionCommands(options);
  useEffect(() => {
    handleRef.current = handle;
  }, [handle, handleRef]);
  return null;
}
