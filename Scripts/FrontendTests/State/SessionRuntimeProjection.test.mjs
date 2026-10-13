import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/generatedEventCatalog.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestSessionId } from "./sessionProjectorTestUtils.mjs";

test("projects runtime status into the session snapshot and keeps the last measured context value", () => {
  const state = createTestState({
    sessions: { [TestSessionId]: { sessionId: TestSessionId, runs: [], messages: [] } },
  });

  applyEvent(
    state,
    createEvent(EventKinds.SessionRuntimeStatus, {
      sessionId: TestSessionId,
      available: true,
      runtime: {
        contextUsage: { tokens: 12_000, contextWindow: 100_000, percent: 12 },
        stats: { tokens: { total: 12_000 } },
      },
    }),
  );
  applyEvent(
    state,
    createEvent(EventKinds.SessionRuntimeStatus, {
      sessionId: TestSessionId,
      available: true,
      runtime: { contextUsage: { tokens: null, contextWindow: 100_000, percent: null } },
    }),
  );

  expect(state.sessions[TestSessionId].runtimeSnapshot).toMatchObject({
    available: true,
    runtime: { contextUsage: { tokens: 12_000, contextWindow: 100_000, percent: 12 } },
  });
  expect(state.runtimeSnapshotsBySession[TestSessionId]).toMatchObject({
    runtime: { contextUsage: { tokens: 12_000, contextWindow: 100_000, percent: 12 } },
  });
});

test("does not create a phantom session for a delayed runtime status", () => {
  const state = createTestState();

  applyEvent(
    state,
    createEvent(EventKinds.SessionRuntimeStatus, {
      sessionId: TestSessionId,
      available: true,
      runtime: { contextUsage: { tokens: 1, contextWindow: 100, percent: 1 } },
    }),
  );

  expect(state.sessions).toEqual({});
});
