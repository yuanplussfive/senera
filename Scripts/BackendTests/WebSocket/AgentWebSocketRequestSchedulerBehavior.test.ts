import { describe, expect, test } from "vitest";
import type { AgentWebSocketRequest } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketProtocol.js";
import {
  AgentWebSocketRequestLanes,
  AgentWebSocketRequestScheduler,
  inspectAgentWebSocketRequestScheduling,
} from "../../../Source/AgentSystem/WebSocket/AgentWebSocketRequestScheduler.js";
import { createDeferred } from "../Support/AsyncTestFixtures.js";

describe("WebSocket request scheduling", () => {
  test("keeps approval and cancellation controls independent of a long-running message", async () => {
    const scheduler = new AgentWebSocketRequestScheduler();
    const run = createDeferred<void>();
    const controlStarted = createDeferred<void>();
    const message = request({ type: "session.message", sessionId: "session-1" });
    const approval = request({ type: "approval.resolve", approvalId: "approval-1" });

    const messageTask = scheduler.run(message, () => run.promise);
    await scheduler.run(approval, async () => {
      controlStarted.resolve();
    });

    await controlStarted.promise;
    let messageSettled = false;
    void messageTask.finally(() => {
      messageSettled = true;
    });
    expect(messageSettled).toBe(false);
    run.resolve();
    await messageTask;
  });

  test("serializes the same session across sockets while allowing different sessions", async () => {
    const scheduler = new AgentWebSocketRequestScheduler();
    const firstFinished = createDeferred<void>();
    let sameSessionHasStarted = false;
    const differentSessionStarted = createDeferred<void>();
    const first = scheduler.run(request({ type: "session.rename", sessionId: "session-1" }), async () => {
      await firstFinished.promise;
    });
    const second = scheduler.run(request({ type: "session.truncate_from", sessionId: "session-1" }), async () => {
      sameSessionHasStarted = true;
    });
    const different = scheduler.run(request({ type: "session.rename", sessionId: "session-2" }), async () => {
      differentSessionStarted.resolve();
    });

    await differentSessionStarted.promise;
    await Promise.resolve();
    expect(sameSessionHasStarted).toBe(false);
    firstFinished.resolve();
    await Promise.all([first, second, different]);
    expect(sameSessionHasStarted).toBe(true);
  });

  test("exposes an exhaustive lane and key for control-plane diagnostics", () => {
    expect(inspectAgentWebSocketRequestScheduling(request({ type: "approval.resolve", approvalId: "a" }))).toEqual({
      lane: AgentWebSocketRequestLanes.Concurrent,
    });
    expect(
      inspectAgentWebSocketRequestScheduling(request({ type: "execution.resource.write", resourceId: "r" })),
    ).toEqual({
      lane: AgentWebSocketRequestLanes.Serial,
      key: "execution-resource:r",
    });
    expect(
      inspectAgentWebSocketRequestScheduling(request({ type: "session.message", sessionId: "session-1", input: "x" })),
    ).toEqual({ lane: AgentWebSocketRequestLanes.Serial, key: "session:session-1" });
    expect(
      inspectAgentWebSocketRequestScheduling(
        request({ type: "session.message", sessionId: "session-1", input: "x", queueMode: "steer" }),
      ),
    ).toEqual({ lane: AgentWebSocketRequestLanes.Concurrent });
    expect(
      inspectAgentWebSocketRequestScheduling(
        request({
          type: "session.regenerate",
          sessionId: "session-1",
          fromRequestId: "request-1",
          requestId: "request-2",
          input: "x",
        }),
      ),
    ).toEqual({ lane: AgentWebSocketRequestLanes.Concurrent });
  });
});

function request(input: Record<string, unknown>): AgentWebSocketRequest {
  return input as AgentWebSocketRequest;
}
