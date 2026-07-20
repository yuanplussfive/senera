import { describe, expect, it, vi } from "vitest";
import {
  AgentMcpTaskCancelledError,
  AgentMcpTaskDetachedError,
  AgentMcpTaskInputRequiredError,
  AgentMcpToolClient,
} from "../../../Source/AgentSystem/Mcp/AgentMcpToolClient.js";
import { AgentInteractionInputRuntime } from "../../../Source/AgentSystem/Interaction/AgentInteractionInputRuntime.js";

describe("MCP task recovery", () => {
  it("surfaces a typed detached task after a recoverable post-creation disconnect", async () => {
    const raw = fakeClient({
      stream: async function* () {
        yield { type: "taskCreated", task: task("task-detached", "working", 1) };
        raw.onclose?.();
        throw new Error("transport closed");
      },
    });
    const client = new AgentMcpToolClient(raw as never, clientOptions());

    await expect(client.callTool("remote", {}, { task: true })).rejects.toMatchObject({
      name: "AgentMcpTaskDetachedError",
      taskId: "task-detached",
      toolName: "remote",
    } satisfies Partial<AgentMcpTaskDetachedError>);
  });

  it("reattaches through task status polling and retrieves the terminal result", async () => {
    const states = [task("task-resumed", "working", 1), task("task-resumed", "completed", 1)];
    const result = { content: [{ type: "text", text: "recovered" }], structuredContent: { value: "recovered" } };
    const raw = fakeClient({
      getTask: vi.fn(async () => states.shift()!),
      getTaskResult: vi.fn(async () => result),
    });
    const client = new AgentMcpToolClient(raw as never, clientOptions());
    const observed: string[] = [];

    await expect(
      client.reattachTask("task-resumed", { onTask: (state) => observed.push(state.status) }),
    ).resolves.toEqual(result);
    expect(observed).toEqual(["working", "completed"]);
    expect(raw.experimental.tasks.getTaskResult).toHaveBeenCalledOnce();
  });

  it("replays missing persistent events in cursor order before returning a reattached result", async () => {
    const cursor = { value: 1 };
    const result = { content: [{ type: "text", text: "recovered" }] };
    const request = vi.fn(async () => ({
      events: [
        {
          taskId: "task-events",
          cursor: 3,
          timestamp: "2026-07-17T00:00:03.000Z",
          kind: "progress",
          progress: { completed: 1, total: 1, message: "done" },
        },
        {
          taskId: "task-events",
          cursor: 2,
          timestamp: "2026-07-17T00:00:02.000Z",
          kind: "output",
          output: { stream: "stdout", text: "replayed", byteLength: 8 },
        },
      ],
      nextCursor: 3,
      hasMore: false,
    }));
    const raw = fakeClient({
      capabilities: taskEventCapabilities(),
      request,
      getTask: vi.fn(async () => task("task-events", "completed")),
      getTaskResult: vi.fn(async () => result),
    });
    const client = new AgentMcpToolClient(raw as never, clientOptions());
    const delivered: string[] = [];

    await expect(
      client.reattachTask("task-events", {
        resumableEvents: true,
        taskEventCursor: cursor,
        onOutput: (event) => delivered.push(`output:${event.text}`),
        onProgress: (event) => delivered.push(`progress:${event.message}`),
      }),
    ).resolves.toEqual(result);
    expect(delivered).toEqual(["output:replayed", "progress:done"]);
    expect(cursor.value).toBe(3);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "senera/tasks/events",
        params: expect.objectContaining({ taskId: "task-events", afterCursor: 1 }),
      }),
      expect.anything(),
      expect.any(Object),
    );
  });

  it("rejects resumable event calls when the server did not negotiate the capability", async () => {
    const raw = fakeClient({ capabilities: {} });
    const client = new AgentMcpToolClient(raw as never, clientOptions());

    await expect(client.callTool("remote", {}, { task: true, resumableEvents: true })).rejects.toMatchObject({
      name: "AgentMcpTaskEventCapabilityError",
      serverId: "test",
    });
  });

  it("fails closed when a replay page skips an event cursor", async () => {
    const raw = fakeClient({
      capabilities: taskEventCapabilities(),
      request: vi.fn(async () => ({
        events: [
          {
            taskId: "task-gap",
            cursor: 3,
            timestamp: "2026-07-17T00:00:03.000Z",
            kind: "output",
            output: { stream: "stdout", text: "gap", byteLength: 3 },
          },
        ],
        nextCursor: 3,
        hasMore: false,
      })),
      getTask: vi.fn(async () => task("task-gap", "completed")),
    });
    const client = new AgentMcpToolClient(raw as never, clientOptions());

    await expect(
      client.reattachTask("task-gap", {
        resumableEvents: true,
        taskEventCursor: { value: 1 },
      }),
    ).rejects.toMatchObject({
      name: "AgentMcpTaskEventGapError",
      taskId: "task-gap",
      deliveredCursor: 1,
      pageCursor: 3,
    });
  });

  it.each([
    ["cancelled", AgentMcpTaskCancelledError],
    ["input_required", AgentMcpTaskInputRequiredError],
  ] as const)("fails explicitly when a reattached task is %s", async (status, ErrorType) => {
    const raw = fakeClient({ getTask: vi.fn(async () => task("task-terminal", status)) });
    const client = new AgentMcpToolClient(raw as never, clientOptions());

    await expect(client.reattachTask("task-terminal")).rejects.toBeInstanceOf(ErrorType);
  });

  it("keeps polling an interactive reattached task while its elicitation is input_required", async () => {
    const states = [task("task-input", "input_required", 1), task("task-input", "completed", 1)];
    const result = { content: [{ type: "text", text: "continued" }] };
    const raw = fakeClient({
      getTask: vi.fn(async () => states.shift()!),
      getTaskResult: vi.fn(async () => result),
    });
    const client = new AgentMcpToolClient(raw as never, clientOptions(new AgentInteractionInputRuntime()));

    await expect(
      client.reattachTask("task-input", {
        interactionOwner: {
          sessionId: "session-input",
          requestId: "request-input",
          step: 1,
          toolCallId: "call-input",
          toolName: "InteractiveTool",
        },
      }),
    ).resolves.toEqual(result);
    expect(raw.experimental.tasks.getTask).toHaveBeenCalledTimes(2);
  });

  it("cancels a reattached task when its owning tool call is aborted", async () => {
    const controller = new AbortController();
    const cancelTask = vi.fn(async () => task("task-cancel", "cancelled"));
    const raw = fakeClient({
      getTask: vi.fn(async () => {
        controller.abort("stop recovered task");
        return task("task-cancel", "working", 1);
      }),
      cancelTask,
    });
    const client = new AgentMcpToolClient(raw as never, clientOptions());

    await expect(client.reattachTask("task-cancel", { signal: controller.signal })).rejects.toMatchObject({
      name: "AgentCancellationError",
      message: "stop recovered task",
    });
    expect(cancelTask).toHaveBeenCalledWith("task-cancel", expect.any(Object));
  });
});

function clientOptions(interactionInput?: AgentInteractionInputRuntime) {
  return {
    server: { id: "test", command: "test", args: [], cwd: process.cwd() },
    requestTimeoutMs: 1_000,
    spawnPersistentProcess: vi.fn(),
    executionProfile: { name: "test", kind: "mcp-server", backend: "local", localFallback: "deny" } as const,
    terminationGraceMs: 100,
    interactionInput,
  };
}

function task(
  taskId: string,
  status: "working" | "input_required" | "completed" | "failed" | "cancelled",
  pollInterval?: number,
) {
  const timestamp = "2026-07-17T00:00:00.000Z";
  return { taskId, status, ttl: null, createdAt: timestamp, lastUpdatedAt: timestamp, pollInterval };
}

function fakeClient(options: {
  stream?: () => AsyncGenerator<unknown, void, void>;
  getTask?: ReturnType<typeof vi.fn>;
  getTaskResult?: ReturnType<typeof vi.fn>;
  cancelTask?: ReturnType<typeof vi.fn>;
  request?: ReturnType<typeof vi.fn>;
  capabilities?: unknown;
}) {
  return {
    onclose: undefined as (() => void) | undefined,
    setNotificationHandler: vi.fn(),
    setRequestHandler: vi.fn(),
    close: vi.fn(async () => undefined),
    callTool: vi.fn(),
    request: options.request ?? vi.fn(),
    getServerCapabilities: vi.fn(() => options.capabilities),
    experimental: {
      tasks: {
        callToolStream: options.stream ?? async function* () {},
        getTask: options.getTask ?? vi.fn(),
        getTaskResult: options.getTaskResult ?? vi.fn(),
        cancelTask: options.cancelTask ?? vi.fn(async () => undefined),
      },
    },
  };
}

function taskEventCapabilities() {
  return { experimental: { "senera.task-events": { version: 1 } } };
}
