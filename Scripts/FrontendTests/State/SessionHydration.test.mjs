import { expect, test } from "vitest";
import { blocksSessionInput, readSessionHydrationState } from "../../../Frontend/src/store/session/sessionHydration.ts";

test.each([
  ["catalog", { catalogSynced: false, session: null }, "catalog_loading", true],
  ["history before request", { session: sessionWithHistory() }, "history_loading", true],
  ["history request", { session: sessionWithHistory(), historyLoading: true }, "history_loading", true],
  ["history failure", { session: sessionWithHistory(), historyFailed: true }, "history_failed", true],
  ["empty catalog", { catalogSynced: true, session: null }, "ready", false],
  ["new local session", { session: sessionWithLocalMessage() }, "ready", false],
  ["loaded history", { session: sessionWithHistory(), historyLoaded: true }, "ready", false],
])("readSessionHydrationState returns the single barrier for %s", (_label, input, expected, blocked) => {
  const state = readSessionHydrationState(input);
  expect(state).toBe(expected);
  expect(blocksSessionInput(state)).toBe(blocked);
});

function sessionWithHistory(overrides = {}) {
  return session({ messageCount: 3, ...overrides });
}

function sessionWithLocalMessage(overrides = {}) {
  return session({ messageCount: 1, messages: [{ id: "local" }], ...overrides });
}

function session(overrides = {}) {
  return {
    sessionId: "session-1",
    title: "Session",
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    entryCount: 3,
    messageCount: 0,
    messages: [],
    runs: [],
    ...overrides,
  };
}
