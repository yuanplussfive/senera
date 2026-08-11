import { describe, expect, test, vi } from "vitest";
import { AgentWebSocketExecutionResourceRequestHandlers } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketExecutionResourceRequestHandlers.js";
import { projectAgentWebSocketRequestFailure } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketRequestFailures.js";
import type { AgentWebSocketRequestContext } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketTypes.js";

describe("execution resource WebSocket requests", () => {
  test("lists an empty resource collection when runtime resource control is disabled", async () => {
    const sendEvent = vi.fn();
    const handlers = new AgentWebSocketExecutionResourceRequestHandlers({
      workspaceRoot: "E:\\workspace",
    } as AgentWebSocketRequestContext);

    await handlers.list({ type: "execution.resource.list", sessionId: "session-a" }, sendEvent);

    expect(sendEvent).toHaveBeenCalledWith({
      kind: "execution.resource.snapshot",
      context: { sessionId: "session-a" },
      data: { operation: "list", resources: [] },
    });
  });

  test("projects resource command failures as request errors rather than agent-run failures", () => {
    const event = projectAgentWebSocketRequestFailure(
      {
        type: "execution.resource.signal",
        sessionId: "session-a",
        resourceId: "resource-a",
        signal: "terminate",
      },
      new Error("resource is no longer running"),
    );

    expect(event).toMatchObject({
      kind: "request.invalid",
      context: { sessionId: "session-a" },
      data: {
        code: "request_execution_failed",
        localizedMessage: { key: "websocket.requestFailed" },
        details: {
          requestType: "execution.resource.signal",
          sessionId: "session-a",
          resourceId: "resource-a",
        },
      },
    });
  });
});
