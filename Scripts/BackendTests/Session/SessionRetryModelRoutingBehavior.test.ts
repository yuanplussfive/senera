import { describe, expect, test } from "vitest";
import { createManagerFixture, completedRun, runEvent, userEntry } from "./SessionManagerTestFixtures.js";

describe("session retry model routing", () => {
  test("does not route a retry through the historical model on its failed snapshot", async () => {
    let routedModelProviderId: string | undefined = "not-called";
    const fixture = createManagerFixture({
      loopFactory: (modelProviderId) => {
        routedModelProviderId = modelProviderId;
        return {
          run: async (request) => completedRun(request.requestId ?? "retry-after-model-removal"),
        };
      },
    });
    const sessionId = "session-retry-after-model-removal";
    const failedRequestId = "request-failed-after-model-removal";
    await fixture.manager.createSession({ sessionId });
    const originalUserEntry = userEntry(failedRequestId, "Original task");
    fixture.store.persistEntries(sessionId, [originalUserEntry]);
    const opened = fixture.store.get(sessionId);
    if (opened.kind === "found") opened.session.conversation = [originalUserEntry];
    fixture.store.persistRunSnapshot({
      sessionId,
      requestId: failedRequestId,
      input: "Original task",
      status: "failed",
      startedAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:01.000Z",
      endedAt: "2026-08-05T00:00:01.000Z",
      modelProvider: {
        id: "deleted-model",
        providerId: "deleted-provider",
        kind: "openai",
        endpoint: "chat",
        baseUrl: "https://removed.invalid/v1",
        model: "deleted-model",
      },
    });
    fixture.manager.recordRunEvent(runEvent(sessionId, failedRequestId, 1));

    await fixture.manager.retryFailedRun({
      sessionId,
      failedRequestId,
      requestId: "request-retry-after-model-removal",
      recoveryMode: "retry",
      approvalMode: "agent",
    });

    expect(routedModelProviderId).toBeUndefined();
  });
});
