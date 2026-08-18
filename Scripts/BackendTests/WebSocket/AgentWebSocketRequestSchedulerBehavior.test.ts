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

  test("starts a prefix fork without waiting for the active source turn", async () => {
    const scheduler = new AgentWebSocketRequestScheduler();
    const run = createDeferred<void>();
    const forkStarted = createDeferred<void>();
    const messageTask = scheduler.run(
      request({ type: "session.message", sessionId: "session-1", input: "keep working" }),
      () => run.promise,
    );

    await scheduler.run(
      request({
        type: "session.fork",
        sourceSessionId: "session-1",
        sessionId: "session-2",
        throughRequestId: "request-1",
      }),
      async () => forkStarted.resolve(),
    );

    await forkStarted.promise;
    expect(
      inspectAgentWebSocketRequestScheduling(
        request({
          type: "session.fork",
          sourceSessionId: "session-1",
          sessionId: "session-2",
          throughRequestId: "request-1",
        }),
      ),
    ).toEqual({ lane: AgentWebSocketRequestLanes.Concurrent });
    run.resolve();
    await messageTask;
  });

  test("starts an interactive terminal without waiting for the active agent turn", async () => {
    const scheduler = new AgentWebSocketRequestScheduler();
    const run = createDeferred<void>();
    const terminalStarted = createDeferred<void>();
    const messageTask = scheduler.run(
      request({ type: "session.message", sessionId: "session-1", input: "keep working" }),
      () => run.promise,
    );

    await scheduler.run(request({ type: "execution.resource.start_terminal", sessionId: "session-1" }), async () =>
      terminalStarted.resolve(),
    );

    await terminalStarted.promise;
    let messageSettled = false;
    void messageTask.finally(() => {
      messageSettled = true;
    });
    expect(messageSettled).toBe(false);
    expect(
      inspectAgentWebSocketRequestScheduling(
        request({ type: "execution.resource.start_terminal", sessionId: "session-1" }),
      ),
    ).toEqual({ lane: AgentWebSocketRequestLanes.Concurrent });
    run.resolve();
    await messageTask;
  });

  test("closes distinct terminals concurrently while preserving same-terminal order", async () => {
    const scheduler = new AgentWebSocketRequestScheduler();
    const firstStarted = createDeferred<void>();
    const firstFinished = createDeferred<void>();
    const differentStarted = createDeferred<void>();
    const differentFinished = createDeferred<void>();
    const sameStarted = createDeferred<void>();
    let sameHasStarted = false;
    const closeRequest = (resourceId: string) =>
      request({ type: "execution.resource.close", sessionId: "session-1", resourceId });

    const first = scheduler.run(closeRequest("terminal-a"), async () => {
      firstStarted.resolve();
      await firstFinished.promise;
    });
    const different = scheduler.run(closeRequest("terminal-b"), async () => {
      differentStarted.resolve();
      await differentFinished.promise;
    });
    const same = scheduler.run(closeRequest("terminal-a"), async () => {
      sameHasStarted = true;
      sameStarted.resolve();
    });

    await Promise.all([firstStarted.promise, differentStarted.promise]);
    expect(inspectAgentWebSocketRequestScheduling(closeRequest("terminal-a"))).toEqual({
      lane: AgentWebSocketRequestLanes.Serial,
      key: "execution-resource:terminal-a",
    });
    expect(inspectAgentWebSocketRequestScheduling(closeRequest("terminal-b"))).toEqual({
      lane: AgentWebSocketRequestLanes.Serial,
      key: "execution-resource:terminal-b",
    });
    await Promise.resolve();
    expect(sameHasStarted).toBe(false);
    firstFinished.resolve();
    await first;
    await sameStarted.promise;
    differentFinished.resolve();
    await Promise.all([different, same]);
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
      inspectAgentWebSocketRequestScheduling(request({ type: "session.runtime_status", sessionId: "session-1" })),
    ).toEqual({ lane: AgentWebSocketRequestLanes.Concurrent });
    expect(
      inspectAgentWebSocketRequestScheduling(
        request({
          type: "approval.resolve_batch",
          sessionId: "session-1",
          requestId: "request-1",
          batchId: "batch-1",
        }),
      ),
    ).toEqual({
      lane: AgentWebSocketRequestLanes.Serial,
      key: "approval-batch:session-1:request-1:batch-1",
    });
    expect(
      inspectAgentWebSocketRequestScheduling(request({ type: "execution.resource.write", resourceId: "r" })),
    ).toEqual({
      lane: AgentWebSocketRequestLanes.Serial,
      key: "execution-resource:r",
    });
    expect(
      inspectAgentWebSocketRequestScheduling(
        request({ type: "execution.resource.close", sessionId: "session-1", resourceId: "r" }),
      ),
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
