import { describe, expect, test, vi } from "vitest";
import { AgentWebSocketRequestSchema } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketProtocol.js";
import { projectAgentWebSocketRequestFailure } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketRequestFailures.js";
import { AgentWebSocketSessionRequestHandlers } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketRequestHandlers.js";
import type { AgentWebSocketRequestContext } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketTypes.js";
import { AgentWebSocketMessageRouter } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketMessageRouter.js";
import type { WebSocket } from "ws";

describe("Session regeneration WebSocket behavior", () => {
  test("accepts only declared first-message dispositions", () => {
    const request = {
      type: "session.message",
      sessionId: "session-new",
      requestId: "request-new",
      input: "Start atomically",
    };

    expect(AgentWebSocketRequestSchema.safeParse({ ...request, disposition: "create_if_missing" }).success).toBe(true);
    expect(AgentWebSocketRequestSchema.safeParse({ ...request, disposition: "replace_existing" }).success).toBe(false);
  });

  test("forwards the first-message disposition to the session manager", async () => {
    const submitMessage = vi.fn(async () => {});
    const handler = new AgentWebSocketSessionRequestHandlers({
      sessionManager: { submitMessage },
    } as unknown as AgentWebSocketRequestContext);
    const sendEvent = vi.fn();

    await handler.message(
      {
        type: "session.message",
        sessionId: "session-new",
        requestId: "request-new",
        input: "Start atomically",
        disposition: "create_if_missing",
      },
      sendEvent,
    );

    expect(submitMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-new",
        requestId: "request-new",
        disposition: "create_if_missing",
        onEvent: sendEvent,
      }),
    );
  });

  test("accepts a complete atomic regeneration command", () => {
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "session.regenerate",
        sessionId: "session-a",
        fromRequestId: "request-old",
        requestId: "request-new",
        modelProviderId: "provider-a",
        input: "Try a different approach",
      }).success,
    ).toBe(true);

    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "session.regenerate",
        sessionId: "session-a",
        fromRequestId: "request-old",
        input: "Missing replacement request id",
      }).success,
    ).toBe(false);
  });

  test("forwards every regeneration field to the session manager", async () => {
    const regenerateFromRequest = vi.fn(async () => {});
    const handler = new AgentWebSocketSessionRequestHandlers({
      sessionManager: { regenerateFromRequest },
    } as unknown as AgentWebSocketRequestContext);
    const sendEvent = vi.fn();
    const attachments = [
      {
        uploadUri: "senera://upload/source",
        name: "source.ts",
        mime: "text/plain",
        size: 10,
        status: "uploaded" as const,
      },
    ];

    await handler.regenerate(
      {
        type: "session.regenerate",
        sessionId: "session-a",
        fromRequestId: "request-old",
        requestId: "request-new",
        modelProviderId: "provider-a",
        input: "Try a different approach",
        attachments,
      },
      sendEvent,
    );

    expect(regenerateFromRequest).toHaveBeenCalledWith({
      sessionId: "session-a",
      fromRequestId: "request-old",
      requestId: "request-new",
      modelProviderId: "provider-a",
      input: "Try a different approach",
      attachments,
      onEvent: sendEvent,
    });
  });

  test("correlates regeneration failures with the optimistic replacement run", () => {
    const failure = projectAgentWebSocketRequestFailure(
      {
        type: "session.regenerate",
        sessionId: "session-a",
        fromRequestId: "request-old",
        requestId: "request-new",
        input: "Try a different approach",
      },
      new Error("regeneration failed"),
      {} as AgentWebSocketRequestContext,
    );

    expect(failure).toEqual(
      expect.objectContaining({
        kind: "run.failed",
        context: expect.objectContaining({
          sessionId: "session-a",
          requestId: "request-new",
        }),
      }),
    );
  });

  test("replays authoritative history after an optimistic regeneration fails", async () => {
    const regenerateFromRequest = vi.fn(async () => {
      throw new Error("regeneration failed");
    });
    const replayHistory = vi.fn(async (request: { onEvent?: (event: never) => void }) => {
      request.onEvent?.({ kind: "session.history.started" } as never);
      request.onEvent?.({ kind: "session.history.completed" } as never);
    });
    const events: Array<{ kind: string }> = [];
    const router = new AgentWebSocketMessageRouter({
      context: {
        sessionManager: { regenerateFromRequest, replayHistory },
      } as unknown as AgentWebSocketRequestContext,
      sendEnvelope: (_socket, event) => {
        events.push(event);
      },
      broadcast: vi.fn(),
    });

    await router.handleMessage(
      {} as WebSocket,
      Buffer.from(
        JSON.stringify({
          type: "session.regenerate",
          sessionId: "session-a",
          fromRequestId: "request-old",
          requestId: "request-new",
          input: "Try a different approach",
        }),
      ),
    );

    expect(events.map((event) => event.kind)).toEqual([
      "run.failed",
      "session.history.started",
      "session.history.completed",
    ]);
    expect(replayHistory).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-a", refresh: true, onEvent: expect.any(Function) }),
    );
  });
});
