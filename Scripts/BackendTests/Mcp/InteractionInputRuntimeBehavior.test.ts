import { describe, expect, test, vi } from "vitest";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import {
  AgentInteractionInputRuntime,
  AgentInteractionInputValidationError,
} from "../../../Source/AgentSystem/Interaction/AgentInteractionInputRuntime.js";
import { AgentInteractionInputActions } from "../../../Source/AgentSystem/Interaction/AgentInteractionInputTypes.js";
import { resolveAgentExternalUrl } from "../../../Source/AgentSystem/Interaction/AgentExternalUrlPolicy.js";

describe("interactive input runtime", () => {
  test("keeps an invalid response pending and resolves a later valid form submission", async () => {
    const runtime = new AgentInteractionInputRuntime();
    const events: AgentDomainEvent[] = [];
    const globalSink = vi.fn();
    runtime.setEventSink(globalSink);
    const pending = runtime.request({
      owner: owner("call-form"),
      mode: "form",
      message: "Choose a deployment target",
      schema: {
        type: "object",
        properties: {
          environment: { type: "string", enum: ["staging", "production"] },
          replicas: { type: "integer", minimum: 1, maximum: 10 },
        },
        required: ["environment", "replicas"],
      },
      onEvent: (event) => {
        events.push(event);
      },
    });
    const request = runtime.listPending()[0]!;

    await expect(
      runtime.resolve({
        interactionId: request.interactionId,
        action: AgentInteractionInputActions.Accept,
        content: { environment: "production", replicas: 0 },
      }),
    ).rejects.toBeInstanceOf(AgentInteractionInputValidationError);
    expect(runtime.listPending()).toHaveLength(1);

    await runtime.resolve({
      interactionId: request.interactionId,
      action: AgentInteractionInputActions.Accept,
      content: { environment: "production", replicas: 3 },
    });

    await expect(pending).resolves.toMatchObject({
      action: "accept",
      content: { environment: "production", replicas: 3 },
    });
    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.InteractionInputRequested,
      AgentEventKinds.InteractionInputResolved,
    ]);
    expect(globalSink).not.toHaveBeenCalled();
    expect(runtime.listPending()).toEqual([]);
  });

  test("keeps accepted URL elicitation active until the MCP completion notification", async () => {
    const runtime = new AgentInteractionInputRuntime();
    const events: AgentDomainEvent[] = [];
    const response = runtime.request({
      owner: owner("call-url"),
      mode: "url",
      externalId: "oauth-login",
      message: "Sign in to continue",
      url: "https://accounts.example.com/oauth/authorize?client=senera",
      onEvent: (event) => {
        events.push(event);
      },
    });
    const request = runtime.listPending()[0]!;

    await runtime.resolve({ interactionId: request.interactionId, action: "accept" });

    await expect(response).resolves.toMatchObject({ action: "accept" });
    expect(runtime.listPending()).toEqual([
      expect.objectContaining({ mode: "url", externalId: "oauth-login", hostname: "accounts.example.com" }),
    ]);
    expect(interactionStatuses(events)).toEqual(["pending", "external_pending"]);

    await expect(runtime.completeExternal("oauth-login")).resolves.toBe(true);
    expect(runtime.listPending()).toEqual([]);
    expect(interactionStatuses(events)).toEqual(["pending", "external_pending", "resolved"]);
  });

  test("applies a declarative external URL policy before asking the user", () => {
    expect(resolveAgentExternalUrl("https://accounts.example.com/login")).toMatchObject({
      protocol: "https:",
      hostname: "accounts.example.com",
    });
    expect(resolveAgentExternalUrl("http://127.0.0.1:8787/callback")).toMatchObject({ protocol: "http:" });
    expect(() => resolveAgentExternalUrl("http://accounts.example.com/login")).toThrow("must use HTTPS");
    expect(() => resolveAgentExternalUrl("https://user:password@accounts.example.com/login")).toThrow(
      "must not contain embedded credentials",
    );
  });

  test("isolates concurrent requests and supports explicit decline", async () => {
    const runtime = new AgentInteractionInputRuntime();
    const first = runtime.request(requestOptions("call-first"));
    const second = runtime.request(requestOptions("call-second"));
    const [firstRequest, secondRequest] = runtime.listPending();

    await runtime.resolve({
      interactionId: secondRequest!.interactionId,
      action: AgentInteractionInputActions.Decline,
    });
    expect(runtime.listPending().map((request) => request.toolCallId)).toEqual(["call-first"]);
    await expect(second).resolves.toMatchObject({ action: "decline" });

    await runtime.resolve({
      interactionId: firstRequest!.interactionId,
      action: AgentInteractionInputActions.Accept,
      content: { confirmed: true },
    });
    await expect(first).resolves.toMatchObject({ action: "accept", content: { confirmed: true } });
  });

  test("turn cancellation resolves every request owned by that request id", async () => {
    const runtime = new AgentInteractionInputRuntime();
    const controller = new AbortController();
    const pending = runtime.request({ ...requestOptions("call-abort"), signal: controller.signal });
    controller.abort(new Error("replacement requested"));

    await expect(pending).resolves.toMatchObject({ action: "cancel", message: "replacement requested" });
    expect(runtime.listPending()).toEqual([]);
  });

  test("close cancels all pending requests without rejecting their suspended MCP handlers", async () => {
    const runtime = new AgentInteractionInputRuntime();
    const pending = [runtime.request(requestOptions("call-a")), runtime.request(requestOptions("call-b"))];
    await runtime.close("server shutdown");

    await expect(Promise.all(pending)).resolves.toEqual([
      expect.objectContaining({ action: "cancel", message: "server shutdown" }),
      expect.objectContaining({ action: "cancel", message: "server shutdown" }),
    ]);
  });

  test("automatically expires interactive input at its configured deadline", async () => {
    vi.useFakeTimers();
    try {
      const runtime = new AgentInteractionInputRuntime({ defaultDeadlineMs: 25 });
      const events: AgentDomainEvent[] = [];
      const pending = runtime.request({
        ...requestOptions("call-deadline"),
        onEvent: (event) => {
          events.push(event);
        },
      });

      await vi.advanceTimersByTimeAsync(25);

      await expect(pending).resolves.toMatchObject({ action: AgentInteractionInputActions.Cancel });
      expect(events.at(-1)).toMatchObject({
        kind: AgentEventKinds.InteractionInputResolved,
        data: { status: "expired" },
      });
      expect(runtime.listPending()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

function owner(toolCallId: string) {
  return {
    sessionId: "session-interaction",
    requestId: "request-interaction",
    step: 2,
    toolCallId,
    toolName: "InteractiveTool",
  };
}

function requestOptions(toolCallId: string) {
  return {
    owner: owner(toolCallId),
    mode: "form" as const,
    message: "Confirm the operation",
    schema: {
      type: "object" as const,
      properties: { confirmed: { type: "boolean" as const } },
      required: ["confirmed"],
    },
  };
}

function interactionStatuses(events: AgentDomainEvent[]): string[] {
  return events.map((event) => (event.data as { status: string }).status);
}
