import { describe, expect, test, vi } from "vitest";
import {
  ElicitationCompleteNotificationSchema,
  UrlElicitationRequiredError,
  type ElicitRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { AgentInteractionInputRuntime } from "../../../Source/AgentSystem/Interaction/AgentInteractionInputRuntime.js";
import { AgentMcpToolClient } from "../../../Source/AgentSystem/Mcp/AgentMcpToolClient.js";

describe("MCP form elicitation", () => {
  test("suspends the same tool call and returns accepted content to the MCP request", async () => {
    const runtime = new AgentInteractionInputRuntime();
    const raw = interactiveClient();
    const client = new AgentMcpToolClient(raw.client as never, clientOptions(runtime));
    const call = client.callTool("configure", {}, { interactionOwner: owner("call-configure") });
    await vi.waitFor(() => expect(runtime.listPending()).toHaveLength(1));
    const request = runtime.listPending()[0]!;

    await runtime.resolve({
      interactionId: request.interactionId,
      action: "accept",
      content: { region: "eu-west", replicas: 2 },
    });

    await expect(call).resolves.toEqual({ action: "accept", content: { region: "eu-west", replicas: 2 } });
    expect(raw.callTool).toHaveBeenCalledOnce();
  });

  test("serializes interactive calls on one pooled client so ownership cannot be crossed", async () => {
    const runtime = new AgentInteractionInputRuntime();
    const raw = interactiveClient();
    const client = new AgentMcpToolClient(raw.client as never, clientOptions(runtime));
    const first = client.callTool("first", {}, { interactionOwner: owner("call-first") });
    await vi.waitFor(() => expect(runtime.listPending().map((request) => request.toolCallId)).toEqual(["call-first"]));
    const second = client.callTool("second", {}, { interactionOwner: owner("call-second") });
    await Promise.resolve();
    expect(raw.callTool).toHaveBeenCalledOnce();

    await runtime.resolve({ interactionId: runtime.listPending()[0]!.interactionId, action: "decline" });
    await expect(first).resolves.toMatchObject({ action: "decline" });
    await vi.waitFor(() => expect(runtime.listPending().map((request) => request.toolCallId)).toEqual(["call-second"]));
    await runtime.resolve({ interactionId: runtime.listPending()[0]!.interactionId, action: "cancel" });
    await expect(second).resolves.toMatchObject({ action: "cancel" });
    expect(raw.callTool).toHaveBeenCalledTimes(2);
  });

  test("accepts URL elicitation and retires it only after the server completion notification", async () => {
    const runtime = new AgentInteractionInputRuntime();
    const raw = interactiveClient({ url: true });
    const client = new AgentMcpToolClient(raw.client as never, clientOptions(runtime));
    const call = client.callTool("authenticate", {}, { interactionOwner: owner("call-url") });

    await vi.waitFor(() => expect(runtime.listPending()).toHaveLength(1));
    const request = runtime.listPending()[0]!;
    expect(request).toMatchObject({
      mode: "url",
      hostname: "accounts.example.com",
    });
    expect(request.mode === "url" ? request.externalId : "").toContain(":external-login");
    await runtime.resolve({ interactionId: request.interactionId, action: "accept" });

    await expect(call).resolves.toEqual({ action: "accept" });
    expect(runtime.listPending()).toHaveLength(1);
    raw.completeExternal("external-login");
    await vi.waitFor(() => expect(runtime.listPending()).toEqual([]));
  });

  test("waits for required URL completion and retries the original tool call once", async () => {
    const runtime = new AgentInteractionInputRuntime();
    const raw = interactiveClient({ urlRequiredError: true });
    const client = new AgentMcpToolClient(raw.client as never, clientOptions(runtime));
    const call = client.callTool("authenticate", {}, { interactionOwner: owner("call-url-required") });

    await vi.waitFor(() => expect(runtime.listPending()).toHaveLength(1));
    const request = runtime.listPending()[0]!;
    await runtime.resolve({ interactionId: request.interactionId, action: "accept" });
    let settled = false;
    void call.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    raw.completeExternal("external-required");

    await expect(call).resolves.toEqual({ retried: true });
    expect(raw.callTool).toHaveBeenCalledTimes(2);
  });

  test("returns a client task immediately and stores accepted form input asynchronously", async () => {
    const runtime = new AgentInteractionInputRuntime();
    const raw = interactiveClient({ taskAugmented: true });
    const client = new AgentMcpToolClient(raw.client as never, clientOptions(runtime));
    const call = client.callTool("configure", {}, { interactionOwner: owner("call-task") });

    await vi.waitFor(() => expect(runtime.listPending()).toHaveLength(1));
    await expect(call).resolves.toEqual({ task: expect.objectContaining({ taskId: "client-task" }) });
    expect(raw.taskStore.storeTaskResult).not.toHaveBeenCalled();

    await runtime.resolve({
      interactionId: runtime.listPending()[0]!.interactionId,
      action: "accept",
      content: { region: "ap-southeast", replicas: 3 },
    });

    await vi.waitFor(() =>
      expect(raw.taskStore.storeTaskResult).toHaveBeenCalledWith("client-task", "completed", {
        action: "accept",
        content: { region: "ap-southeast", replicas: 3 },
      }),
    );
    expect(raw.taskStore.createTask).toHaveBeenCalledWith({ ttl: 5_000 });
  });

  test("reports a background task-store settlement failure through the MCP client", async () => {
    const runtime = new AgentInteractionInputRuntime();
    const raw = interactiveClient({ taskAugmented: true });
    const onerror = vi.fn();
    raw.client.onerror = onerror;
    raw.taskStore.storeTaskResult.mockRejectedValue(new Error("task store unavailable"));
    const client = new AgentMcpToolClient(raw.client as never, clientOptions(runtime));
    const call = client.callTool("configure", {}, { interactionOwner: owner("call-task-failure") });

    await vi.waitFor(() => expect(runtime.listPending()).toHaveLength(1));
    await expect(call).resolves.toEqual({ task: expect.objectContaining({ taskId: "client-task" }) });
    await runtime.resolve({
      interactionId: runtime.listPending()[0]!.interactionId,
      action: "cancel",
    });

    await vi.waitFor(() =>
      expect(onerror).toHaveBeenCalledWith(expect.objectContaining({ message: "task store unavailable" })),
    );
    expect(raw.taskStore.storeTaskResult).toHaveBeenCalledTimes(2);
  });
});

function interactiveClient(options: { taskAugmented?: boolean; url?: boolean; urlRequiredError?: boolean } = {}) {
  const taskStore = {
    createTask: vi.fn(async () => task("client-task")),
    storeTaskResult: vi.fn(async () => undefined),
  };
  let handler:
    | ((
        request: ElicitRequest,
        extra?: { taskStore?: typeof taskStore; taskRequestedTtl?: number },
      ) => Promise<unknown>)
    | undefined;
  let completionHandler: ((notification: { params: { elicitationId: string } }) => void) | undefined;
  let callCount = 0;
  const callTool = vi.fn(async ({ name }: { name: string }) => {
    callCount += 1;
    if (options.urlRequiredError) {
      if (callCount === 1) {
        throw new UrlElicitationRequiredError([
          {
            mode: "url",
            elicitationId: "external-required",
            message: "Authenticate to continue",
            url: "https://accounts.example.com/oauth/authorize",
          },
        ]);
      }
      return { retried: true };
    }
    if (!handler) throw new Error("elicitation handler was not registered");
    return handler(
      {
        method: "elicitation/create",
        params: {
          message: `Configure ${name}`,
          ...(options.taskAugmented ? { task: { ttl: 5_000 } } : {}),
          ...(options.url
            ? {
                mode: "url",
                elicitationId: "external-login",
                url: "https://accounts.example.com/oauth/authorize",
              }
            : {
                mode: "form",
                requestedSchema: {
                  type: "object",
                  properties: {
                    region: { type: "string" },
                    replicas: { type: "integer", minimum: 1 },
                  },
                },
              }),
        },
      },
      options.taskAugmented ? { taskStore, taskRequestedTtl: 5_000 } : undefined,
    );
  });
  return {
    taskStore,
    callTool,
    completeExternal: (elicitationId: string) => completionHandler?.({ params: { elicitationId } }),
    client: {
      onclose: undefined,
      onerror: undefined as ((error: Error) => void) | undefined,
      setNotificationHandler: vi.fn((schema, nextHandler) => {
        if (schema === ElicitationCompleteNotificationSchema) {
          completionHandler = nextHandler as typeof completionHandler;
        }
      }),
      setRequestHandler: vi.fn((_schema, nextHandler) => {
        handler = nextHandler as typeof handler;
      }),
      callTool,
      close: vi.fn(async () => undefined),
      getServerCapabilities: vi.fn(() => ({})),
      experimental: { tasks: {} },
    },
  };
}

function task(taskId: string) {
  const timestamp = "2026-07-17T00:00:00.000Z";
  return {
    taskId,
    status: "working" as const,
    ttl: 5_000,
    createdAt: timestamp,
    lastUpdatedAt: timestamp,
  };
}

function clientOptions(interactionInput: AgentInteractionInputRuntime) {
  return {
    server: { id: "elicitation", command: "test", args: [], cwd: process.cwd() },
    requestTimeoutMs: 1_000,
    spawnPersistentProcess: vi.fn(),
    executionProfile: { name: "elicitation", kind: "mcp-server", backend: "local" } as const,
    terminationGraceMs: 100,
    interactionInput,
  };
}

function owner(toolCallId: string) {
  return {
    sessionId: "session-elicitation",
    requestId: "request-elicitation",
    step: 1,
    toolCallId,
    toolName: "InteractiveTool",
  };
}
