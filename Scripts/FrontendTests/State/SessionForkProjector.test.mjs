import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState } from "./sessionProjectorTestUtils.mjs";

test("session.forked selects the authoritative target and inherits source model selection", () => {
  const state = createTestState();
  state.sessions.source = session("source", "Source");
  state.sessions.fork = session("fork", "New chat");
  state.sessionOrder = ["fork", "source"];
  state.activeSessionId = "source";
  state.modelProviders = [{ id: "provider-a", capabilities: { Chat: true } }];
  state.selectedModelProviderIdsBySession.source = "provider-a";

  applyEvent(
    state,
    createEvent(
      EventKinds.SessionForked,
      {
        sessionId: "fork",
        sourceSessionId: "source",
        throughRequestId: "request-a",
        title: "Source",
        createdAt: "2026-07-17T00:00:02.000Z",
      },
      { sessionId: "fork", requestId: undefined, phase: "session" },
    ),
  );

  expect(state.activeSessionId).toBe("fork");
  expect(state.sessions.fork).toEqual(
    expect.objectContaining({
      title: "Source",
      forkOrigin: { sourceSessionId: "source", throughRequestId: "request-a" },
    }),
  );
  expect(state.selectedModelProviderIdsBySession.fork).toBe("provider-a");
  expect(state.selectedModelProviderId).toBe("provider-a");
});

test.each(["session.fork", "session.message", "session.history"])(
  "%s not-found marks stale local state missing and selects an authoritative session",
  (operation) => {
    const state = createTestState();
    state.sessions.source = {
      ...session("source", "Source"),
      entryCount: 2,
      messageCount: 2,
      messages: [{ id: "message-a", role: "user", content: "stale" }],
      runs: [{ requestId: "request-a", status: "completed" }],
    };
    state.sessions.available = session("available", "Available");
    state.sessionOrder = ["source", "available"];
    state.activeSessionId = "source";
    state.historyLoadedIds.source = true;

    applyEvent(
      state,
      createEvent(
        EventKinds.SessionNotFound,
        { sessionId: "source", operation, message: "missing" },
        { sessionId: "source", requestId: undefined, phase: "session" },
      ),
    );

    expect(state.missingOnServerIds.source).toBe(true);
    expect(state.sessions.source).toEqual(
      expect.objectContaining({ entryCount: 0, messageCount: 0, messages: [], runs: [] }),
    );
    expect(state.historyLoadedIds.source).toBeUndefined();
    expect(state.activeSessionId).toBe("available");
  },
);

function session(sessionId, title) {
  return {
    sessionId,
    title,
    status: "ready",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    entryCount: 0,
    messageCount: 0,
    messages: [],
    runs: [],
  };
}
