import { describe, expect, test } from "vitest";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { collect, createManagerFixture, userEntry } from "./SessionManagerTestFixtures.js";

async function seedSession(sessionId: string, requestIds: readonly string[]) {
  const fixture = createManagerFixture();
  await fixture.manager.createSession({ sessionId });
  fixture.store.persistEntries(
    sessionId,
    requestIds.map((requestId) => userEntry(requestId, requestId)),
  );
  return fixture;
}

describe("Session message feedback behavior", () => {
  test("records a rating as one durable event for the rated turn", async () => {
    const fixture = await seedSession("session-feedback", ["request-a"]);
    const events: AgentDomainEvent[] = [];

    await fixture.manager.recordMessageFeedback({
      sessionId: "session-feedback",
      requestId: "request-a",
      rating: "negative",
      category: "task_result",
      onEvent: collect(events),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: AgentEventKinds.FeedbackRecorded,
      context: { sessionId: "session-feedback", requestId: "request-a" },
      data: { sessionId: "session-feedback", requestId: "request-a", rating: "negative", category: "task_result" },
    });
    expect(events[0].data).toHaveProperty("updatedAt");
  });

  test("retracting emits the same record with a null rating", async () => {
    const fixture = await seedSession("session-feedback-retract", ["request-a"]);
    const events: AgentDomainEvent[] = [];

    await fixture.manager.recordMessageFeedback({
      sessionId: "session-feedback-retract",
      requestId: "request-a",
      rating: null,
      onEvent: collect(events),
    });

    expect(events[0]).toMatchObject({
      kind: AgentEventKinds.FeedbackRecorded,
      data: { rating: null },
    });
    expect(events[0].data).not.toHaveProperty("category");
  });

  test("a rating for an unknown turn is refused instead of recorded", async () => {
    const fixture = await seedSession("session-feedback-missing", ["request-a"]);
    const events: AgentDomainEvent[] = [];

    await fixture.manager.recordMessageFeedback({
      sessionId: "session-feedback-missing",
      requestId: "request-missing",
      rating: "positive",
      onEvent: collect(events),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: AgentEventKinds.RequestInvalid,
      data: { code: "feedback_request_missing" },
    });
  });

  test("a rating for an unknown session reports the missing session", async () => {
    const fixture = createManagerFixture();
    const events: AgentDomainEvent[] = [];

    await fixture.manager.recordMessageFeedback({
      sessionId: "session-absent",
      requestId: "request-a",
      rating: "positive",
      onEvent: collect(events),
    });

    expect(events[0]).toMatchObject({
      kind: AgentEventKinds.SessionNotFound,
      context: { sessionId: "session-absent" },
    });
  });
});
