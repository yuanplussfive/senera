import { expect, test } from "vitest";
import {
  deleteSessionRuntimeState,
  ingestSessionList,
  readFirstAvailableSessionId,
} from "../../../Frontend/src/store/session/sessionListProjection.ts";

test("session list ingest preserves pending local creation and selects the first useful server session", () => {
  const state = createState({
    sessions: {
      local: session("local", { status: "creating" }),
      stale: session("stale"),
    },
    sessionOrder: ["local", "stale"],
    pendingCreatedSessionIds: { local: true },
  });

  ingestSessionList(state, [listItem("empty", { messageCount: 0 }), listItem("active", { messageCount: 2 })]);

  expect(state.sessionOrder).toEqual(["local", "empty", "active"]);
  expect(state.activeSessionId).toBe("local");
  expect(state.sessions.stale).toBeUndefined();
  expect(state.sessions.active).toEqual(
    expect.objectContaining({
      status: "ready",
      messageCount: 2,
    }),
  );
});

test("pending deletion remains hidden until the server confirms removal", () => {
  const state = createState({
    sessions: {
      keep: session("keep"),
      deleting: session("deleting"),
    },
    sessionOrder: ["deleting", "keep"],
    activeSessionId: "deleting",
    pendingDeletedSessionIds: { deleting: true },
    historyLoadedIds: { deleting: true },
    viewedRunIdBySession: { deleting: "request-old" },
  });

  ingestSessionList(state, [listItem("deleting"), listItem("keep")]);
  expect(state.sessions.deleting).toBeDefined();
  expect(state.sessionOrder).toEqual(["keep"]);
  expect(state.activeSessionId).toBe("keep");

  ingestSessionList(state, [listItem("keep")]);
  expect(state.sessions.deleting).toBeUndefined();
  expect(state.pendingDeletedSessionIds.deleting).toBeUndefined();
  expect(state.historyLoadedIds.deleting).toBeUndefined();
  expect(state.viewedRunIdBySession.deleting).toBeUndefined();
});

test("server refresh normalizes running metadata and settles completed history loading", () => {
  const state = createState({
    sessions: {
      settled: session("settled", { status: "creating", messages: [message("message-1")] }),
      recovering: session("recovering", {
        runs: [{ status: "running", recoverySource: "history" }],
      }),
    },
    sessionOrder: ["settled", "recovering"],
    historyLoadingIds: { settled: true, recovering: true },
    historyReplayBuffers: { settled: [{ entry: {} }], recovering: [{ entry: {} }] },
  });

  ingestSessionList(state, [
    listItem("settled", { status: "running", messageCount: 1 }),
    listItem("recovering", { status: "running", messageCount: 0 }),
  ]);

  expect(state.sessions.settled.status).toBe("ready");
  expect(state.historyLoadingIds.settled).toBe(false);
  expect(state.historyReplayBuffers.settled).toBeUndefined();
  expect(state.historyLoadingIds.recovering).toBe(true);
  expect(state.historyReplayBuffers.recovering).toBeDefined();
});

test("session list ingest projects the server-authoritative active request", () => {
  const state = createState({
    sessions: {
      active: session("active", { activeRequestId: "request-stale" }),
    },
    sessionOrder: ["active"],
  });

  ingestSessionList(state, [listItem("active", { status: "running", activeRequestId: "request-current" })]);
  expect(state.sessions.active).toEqual(
    expect.objectContaining({
      status: "ready",
      activeRequestId: "request-current",
    }),
  );

  ingestSessionList(state, [listItem("active", { status: "idle" })]);
  expect(state.sessions.active.activeRequestId).toBeUndefined();
});

test("availability and runtime deletion ignore missing or pending-deleted sessions", () => {
  const state = createState({
    sessions: {
      missing: session("missing"),
      deleting: session("deleting"),
      ready: session("ready"),
    },
    sessionOrder: ["missing", "deleting", "ready"],
    missingOnServerIds: { missing: true },
    pendingDeletedSessionIds: { deleting: true },
    historyFailedIds: { ready: true },
  });

  expect(readFirstAvailableSessionId(state)).toBe("ready");
  expect(readFirstAvailableSessionId(state, "ready")).toBeNull();

  deleteSessionRuntimeState(state, "ready");
  expect(state.sessions.ready).toBeUndefined();
  expect(state.historyFailedIds.ready).toBeUndefined();
  expect(state.sessionOrder).toEqual(["missing", "deleting"]);
});

function createState(overrides = {}) {
  return {
    sessions: {},
    sessionOrder: [],
    activeSessionId: null,
    viewedRunIdBySession: {},
    historyLoadedIds: {},
    historyLoadingIds: {},
    historyFailedIds: {},
    historyReplayBuffers: {},
    historyStepBuffers: {},
    historyEventRunIds: {},
    historyActiveRequestIds: {},
    missingOnServerIds: {},
    pendingCreatedSessionIds: {},
    pendingDeletedSessionIds: {},
    defaultModelProviderId: null,
    selectedModelProviderIdsBySession: {},
    ...overrides,
  };
}

function session(sessionId, overrides = {}) {
  return {
    sessionId,
    title: sessionId,
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    entryCount: 0,
    messageCount: 0,
    messages: [],
    runs: [],
    ...overrides,
  };
}

function listItem(sessionId, overrides = {}) {
  return {
    sessionId,
    title: sessionId,
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    entryCount: 0,
    messageCount: 0,
    ...overrides,
  };
}

function message(id) {
  return {
    id,
    role: "user",
    content: id,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}
