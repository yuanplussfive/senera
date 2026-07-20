import { describe, expect, test, vi } from "vitest";
import { AgentWebSocketRequestSchema } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketProtocol.js";
import { AgentWebSocketSessionRequestHandlers } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketRequestHandlers.js";
import type { AgentWebSocketRequestContext } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketTypes.js";

describe("Session fork WebSocket behavior", () => {
  test("accepts only complete fork requests", () => {
    const request = {
      type: "session.fork",
      sourceSessionId: "session-source",
      sessionId: "session-fork",
      throughRequestId: "request-a",
    };

    expect(AgentWebSocketRequestSchema.safeParse(request).success).toBe(true);
    expect(AgentWebSocketRequestSchema.safeParse({ ...request, throughRequestId: "" }).success).toBe(false);
    expect(AgentWebSocketRequestSchema.safeParse({ ...request, extra: true }).success).toBe(false);
  });

  test("forwards the complete request to the session manager", async () => {
    const forkSession = vi.fn(async () => {});
    const handler = new AgentWebSocketSessionRequestHandlers({
      sessionManager: { forkSession },
    } as unknown as AgentWebSocketRequestContext);
    const sendEvent = vi.fn();

    await handler.fork(
      {
        type: "session.fork",
        sourceSessionId: "session-source",
        sessionId: "session-fork",
        throughRequestId: "request-a",
      },
      sendEvent,
    );

    expect(forkSession).toHaveBeenCalledWith({
      sourceSessionId: "session-source",
      sessionId: "session-fork",
      throughRequestId: "request-a",
      onEvent: sendEvent,
    });
  });
});
