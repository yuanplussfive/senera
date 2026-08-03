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

  test("validates and forwards Pi session management requests", async () => {
    expect(AgentWebSocketRequestSchema.safeParse({ type: "session.compact", sessionId: "session-a" }).success).toBe(
      true,
    );
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "session.export",
        sessionId: "session-a",
        format: "jsonl",
      }).success,
    ).toBe(true);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "session.export",
        sessionId: "session-a",
        format: "text",
      }).success,
    ).toBe(false);

    const compactSession = vi.fn(async () => {});
    const emitPiSessionRuntimeStatus = vi.fn(async () => {});
    const exportPiSession = vi.fn(async () => {});
    const handler = new AgentWebSocketSessionRequestHandlers({
      sessionManager: { compactSession, emitPiSessionRuntimeStatus, exportPiSession },
    } as unknown as AgentWebSocketRequestContext);
    const sendEvent = vi.fn();

    await handler.compact({ type: "session.compact", sessionId: "session-a" }, sendEvent);
    await handler.runtimeStatus({ type: "session.runtime_status", sessionId: "session-a" }, sendEvent);
    await handler.export({ type: "session.export", sessionId: "session-a", format: "html" }, sendEvent);

    expect(compactSession).toHaveBeenCalledWith({
      sessionId: "session-a",
      customInstructions: undefined,
      onEvent: sendEvent,
    });
    expect(emitPiSessionRuntimeStatus).toHaveBeenCalledWith({ sessionId: "session-a", onEvent: sendEvent });
    expect(exportPiSession).toHaveBeenCalledWith({ sessionId: "session-a", format: "html", onEvent: sendEvent });
  });
});
