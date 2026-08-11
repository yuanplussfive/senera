import { describe, expect, test, vi } from "vitest";
import { AgentWebSocketSessionRequestHandlers } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketRequestHandlers.js";
import type { AgentWebSocketRequestContext } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketTypes.js";

describe("Session cancellation WebSocket behavior", () => {
  test("admits cancellation through the non-blocking control-plane operation", async () => {
    const requestActiveRunCancellation = vi.fn(async () => true);
    const cancelActiveRun = vi.fn(() => new Promise<boolean>(() => undefined));
    const handler = new AgentWebSocketSessionRequestHandlers({
      sessionManager: { requestActiveRunCancellation, cancelActiveRun },
    } as unknown as AgentWebSocketRequestContext);
    const sendEvent = vi.fn();

    await expect(
      handler.cancel(
        {
          type: "session.cancel",
          sessionId: "active-session",
        },
        sendEvent,
      ),
    ).resolves.toBeUndefined();

    expect(requestActiveRunCancellation).toHaveBeenCalledWith({
      sessionId: "active-session",
      onEvent: sendEvent,
    });
    expect(cancelActiveRun).not.toHaveBeenCalled();
  });
});
