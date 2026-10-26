import { expect, test } from "vitest";
import { EventKinds } from "../../../Frontend/src/api/eventTypes.ts";
import { applyEvent } from "../../../Frontend/src/store/session/sessionProjector.ts";
import { createEvent, createTestState, TestRequestId, TestSessionId } from "./sessionProjectorTestUtils.mjs";

function createSession(state) {
  applyEvent(state, createEvent(EventKinds.SessionCreated, { sessionId: TestSessionId, title: "反馈" }));
  return state.sessions[TestSessionId];
}

function feedbackEvent(data, overrides = {}) {
  return createEvent(
    EventKinds.FeedbackRecorded,
    { sessionId: TestSessionId, requestId: TestRequestId, ...data },
    { phase: "session", layer: "snapshot", ...overrides },
  );
}

test("a recorded rating is kept per request id", () => {
  const state = createTestState();
  const session = createSession(state);

  applyEvent(
    state,
    feedbackEvent({ rating: "negative", category: "task_result", updatedAt: "2026-07-17T01:00:00.000Z" }),
  );

  expect(session.messageFeedback[TestRequestId]).toMatchObject({
    rating: "negative",
    category: "task_result",
  });
});

test("a later rating replaces the earlier one for the same request", () => {
  const state = createTestState();
  const session = createSession(state);

  applyEvent(state, feedbackEvent({ rating: "negative", updatedAt: "2026-07-17T01:00:00.000Z" }));
  applyEvent(state, feedbackEvent({ rating: "positive", updatedAt: "2026-07-17T02:00:00.000Z" }));

  expect(session.messageFeedback[TestRequestId]).toMatchObject({
    rating: "positive",
    updatedAt: "2026-07-17T02:00:00.000Z",
  });
  expect(session.messageFeedback[TestRequestId].category).toBeUndefined();
});

test("retraction removes the record so an unrated turn has one shape", () => {
  const state = createTestState();
  const session = createSession(state);

  applyEvent(state, feedbackEvent({ rating: "positive", updatedAt: "2026-07-17T01:00:00.000Z" }));
  applyEvent(state, feedbackEvent({ rating: null, updatedAt: "2026-07-17T03:00:00.000Z" }));

  expect(session.messageFeedback).toEqual({});
  expect(session.messageFeedback[TestRequestId]).toBeUndefined();
});

test("a malformed payload never invents a rating", () => {
  const state = createTestState();
  const session = createSession(state);

  applyEvent(state, feedbackEvent({ rating: "maybe", updatedAt: "2026-07-17T01:00:00.000Z" }));
  applyEvent(state, feedbackEvent({ rating: "positive", category: "not_a_category", updatedAt: "x" }));

  expect(session.messageFeedback).toBeUndefined();
});

test("feedback for an unknown session is ignored", () => {
  const state = createTestState();
  createSession(state);

  applyEvent(
    state,
    createEvent(
      EventKinds.FeedbackRecorded,
      { sessionId: "session_missing", requestId: TestRequestId, rating: "positive", updatedAt: "x" },
      { sessionId: "session_missing", phase: "session", layer: "snapshot" },
    ),
  );

  expect(state.sessions[TestSessionId].messageFeedback).toBeUndefined();
});
