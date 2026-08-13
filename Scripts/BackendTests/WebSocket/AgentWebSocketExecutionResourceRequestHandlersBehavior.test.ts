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

  test("starts an interactive terminal through the dedicated runtime", async () => {
    const sendEvent = vi.fn();
    const start = vi.fn().mockResolvedValue({ resourceId: "terminal-a", kind: "terminal" });
    const createSession = vi.fn();
    const handlers = new AgentWebSocketExecutionResourceRequestHandlers({
      workspaceRoot: "E:\\workspace",
      interactiveTerminals: { start },
      sessionManager: { createSession },
    } as unknown as AgentWebSocketRequestContext);

    await handlers.startTerminal(
      {
        type: "execution.resource.start_terminal",
        sessionId: "session-a",
        cwd: "E:\\workspace",
        columns: 120,
        rows: 36,
      },
      sendEvent,
    );

    expect(start).toHaveBeenCalledWith({
      sessionId: "session-a",
      cwd: "E:\\workspace",
      dimensions: { columns: 120, rows: 36 },
    });
    expect(createSession).toHaveBeenCalledWith({ sessionId: "session-a", onEvent: sendEvent });
    expect(sendEvent).toHaveBeenCalledWith({
      kind: "execution.resource.snapshot",
      context: { sessionId: "session-a" },
      data: {
        operation: "start_terminal",
        resources: [{ resourceId: "terminal-a", kind: "terminal" }],
      },
    });
  });

  test("closes one resource and returns the remaining resource snapshot", async () => {
    const sendEvent = vi.fn();
    const release = vi.fn().mockResolvedValue(undefined);
    const list = vi.fn().mockReturnValue([{ resourceId: "terminal-b", kind: "terminal" }]);
    const handlers = new AgentWebSocketExecutionResourceRequestHandlers({
      workspaceRoot: "E:\\workspace",
      executionResources: { release, list },
    } as unknown as AgentWebSocketRequestContext);

    await handlers.close(
      { type: "execution.resource.close", sessionId: "session-a", resourceId: "terminal-a" },
      sendEvent,
    );

    expect(release).toHaveBeenCalledWith("terminal-a", { workspaceRoot: "E:\\workspace", sessionId: "session-a" });
    expect(list).toHaveBeenCalledWith({ workspaceRoot: "E:\\workspace", sessionId: "session-a" });
    expect(sendEvent).toHaveBeenCalledWith({
      kind: "execution.resource.snapshot",
      context: { sessionId: "session-a" },
      data: { operation: "close", resources: [{ resourceId: "terminal-b", kind: "terminal" }] },
    });
  });
});
