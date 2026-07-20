import { describe, expect, test, vi } from "vitest";
import { AgentApprovalRuntime } from "../../../Source/AgentSystem/Approvals/AgentApprovalRuntime.js";
import {
  AgentApprovalDecisions,
  AgentApprovalDispositions,
  AgentApprovalKinds,
} from "../../../Source/AgentSystem/Approvals/AgentApprovalTypes.js";
import { toEventEnvelope, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { projectAgentRunEventForHistory } from "../../../Source/AgentSystem/Events/AgentRunEventHistoryPolicy.js";
import { AgentWebSocketRequestSchema } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketProtocol.js";

describe("approval runtime", () => {
  test("emits a complete requested/resolved lifecycle with stable correlation", async () => {
    const events: AgentDomainEvent[] = [];
    const runtime = new AgentApprovalRuntime();
    runtime.setEventSink(async (event) => {
      events.push(event);
    });

    const pending = runtime.requestApproval(
      approvalRequest({
        sessionId: "session-a",
        requestId: "request-a",
        toolCallId: "call-a",
        batchId: "batch-a",
      }),
    );
    await vi.waitFor(() => expect(events).toHaveLength(1));
    const requested = events[0];
    const approvalId = readApprovalId(requested);

    expect(requested).toMatchObject({
      kind: "approval.requested",
      context: { sessionId: "session-a", requestId: "request-a", step: 1 },
      data: {
        approvalId,
        toolCallId: "call-a",
        batchId: "batch-a",
        status: "pending",
        availableDecisions: ["approve_once", "deny", "deny_and_interrupt"],
      },
    });

    const resolution = await runtime.resolve({
      approvalId,
      decision: AgentApprovalDecisions.ApproveOnce,
      message: "approved",
    });

    await expect(pending).resolves.toEqual(resolution);
    expect(resolution).toMatchObject({
      status: "approved",
      disposition: AgentApprovalDispositions.Proceed,
      scope: "once",
    });
    expect(events[1]).toMatchObject({
      kind: "approval.resolved",
      context: { sessionId: "session-a", requestId: "request-a", step: 1 },
      data: {
        approvalId,
        decision: "approve_once",
        status: "approved",
        disposition: "proceed",
      },
    });
    expect(runtime.listPending("session-a")).toEqual([]);
  });

  test("deduplicates one approval kind per tool call while keeping parallel calls independent", async () => {
    const events: AgentDomainEvent[] = [];
    const runtime = new AgentApprovalRuntime();
    runtime.setEventSink(async (event) => {
      events.push(event);
    });

    const first = runtime.requestApproval(approvalRequest({ toolCallId: "call-1" }));
    const duplicate = runtime.requestApproval(approvalRequest({ toolCallId: "call-1" }));
    const parallel = runtime.requestApproval(approvalRequest({ toolCallId: "call-2" }));
    await vi.waitFor(() => expect(events.filter((event) => event.kind === "approval.requested")).toHaveLength(2));

    const requests = events.filter((event) => event.kind === "approval.requested");
    const firstId = readApprovalId(requests.find((event) => readToolCallId(event) === "call-1"));
    const parallelId = readApprovalId(requests.find((event) => readToolCallId(event) === "call-2"));

    await runtime.resolve({ approvalId: firstId, decision: AgentApprovalDecisions.Deny });
    await expect(first).resolves.toMatchObject({ status: "denied", disposition: "continue" });
    await expect(duplicate).resolves.toMatchObject({ approvalId: firstId });
    expect(runtime.listPending()).toHaveLength(1);

    await runtime.resolve({ approvalId: parallelId, decision: AgentApprovalDecisions.ApproveOnce });
    await expect(parallel).resolves.toMatchObject({ status: "approved" });
  });

  test("rejects unavailable decisions without consuming the pending approval", async () => {
    const events: AgentDomainEvent[] = [];
    const runtime = new AgentApprovalRuntime();
    const pending = runtime.requestApproval(
      approvalRequest({
        onEvent: async (event) => {
          events.push(event);
        },
      }),
    );
    await vi.waitFor(() => expect(events).toHaveLength(1));
    const approvalId = readApprovalId(events[0]);

    await expect(runtime.resolve({ approvalId, decision: AgentApprovalDecisions.ApproveSession })).rejects.toThrow(
      /不适用于当前请求/,
    );
    expect(runtime.getPending(approvalId)).toBeDefined();

    await runtime.resolve({ approvalId, decision: AgentApprovalDecisions.Deny });
    await expect(pending).resolves.toMatchObject({ status: "denied" });
  });

  test("projects cancellation and expiration as terminal outcomes", async () => {
    const events: AgentDomainEvent[] = [];
    const runtime = new AgentApprovalRuntime();
    runtime.setEventSink(async (event) => {
      events.push(event);
    });
    const cancelled = runtime.requestApproval(approvalRequest({ requestId: "cancel-request", toolCallId: "cancel" }));
    const expired = runtime.requestApproval(approvalRequest({ requestId: "expire-request", toolCallId: "expire" }));
    await vi.waitFor(() => expect(runtime.listPending()).toHaveLength(2));

    expect(await runtime.cancelByRequestId("cancel-request", new Error("run cancelled"))).toBe(1);
    await expect(cancelled).resolves.toMatchObject({ status: "cancelled", disposition: "interrupt" });

    const expireId = runtime.listPending().find((approval) => approval.requestId === "expire-request")?.approvalId;
    expect(expireId).toBeTruthy();
    await runtime.expire(expireId!, "approval deadline exceeded");
    await expect(expired).resolves.toMatchObject({ status: "expired", disposition: "continue" });
    expect(events.filter((event) => event.kind === "approval.resolved")).toHaveLength(2);
  });

  test("settles an already-aborted approval without leaving a pending request", async () => {
    const events: AgentDomainEvent[] = [];
    const runtime = new AgentApprovalRuntime();
    runtime.setEventSink(async (event) => {
      events.push(event);
    });
    const controller = new AbortController();
    controller.abort(new Error("request already cancelled"));

    await expect(
      runtime.requestApproval({
        ...approvalRequest({ requestId: "already-cancelled", toolCallId: "cancelled-call" }),
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ status: "cancelled", disposition: "interrupt" });

    expect(runtime.listPending()).toEqual([]);
    expect(events.map((event) => event.kind)).toEqual(["approval.requested", "approval.resolved"]);
  });

  test("automatically expires approvals at their configured deadline", async () => {
    vi.useFakeTimers();
    try {
      const runtime = new AgentApprovalRuntime({ defaultDeadlineMs: 25 });
      const pending = runtime.requestApproval(approvalRequest());

      await vi.advanceTimersByTimeAsync(25);

      await expect(pending).resolves.toMatchObject({ status: "expired", disposition: "continue" });
      expect(runtime.listPending()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("persists approval lifecycle events and accepts only the decision protocol", async () => {
    const event: AgentDomainEvent = {
      kind: "approval.requested",
      context: { sessionId: "session", requestId: "request", step: 1 },
      data: {
        approvalId: "approval",
        approvalKind: AgentApprovalKinds.ToolCall,
        toolCallId: "call",
        title: "Approve tool",
        reason: "Tool requires approval.",
        availableDecisions: [AgentApprovalDecisions.ApproveOnce, AgentApprovalDecisions.Deny],
        subject: { kind: AgentApprovalKinds.ToolCall, toolName: "TestTool", arguments: {} },
        createdAt: "2026-07-16T00:00:00.000Z",
        status: "pending",
      },
    };
    const envelope = toEventEnvelope(event, 1);

    expect(projectAgentRunEventForHistory(envelope)).toEqual(envelope);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "approval.resolve",
        approvalId: "approval",
        decision: "deny_and_interrupt",
      }).success,
    ).toBe(true);
    expect(
      AgentWebSocketRequestSchema.safeParse({
        type: "approval.resolve",
        approvalId: "approval",
        status: "denied",
      }).success,
    ).toBe(false);
  });
});

function approvalRequest(
  overrides: Partial<Parameters<AgentApprovalRuntime["requestApproval"]>[0]["approval"]> & {
    onEvent?: Parameters<AgentApprovalRuntime["requestApproval"]>[0]["onEvent"];
  } = {},
) {
  const { onEvent, ...approvalOverrides } = overrides;
  return {
    onEvent,
    approval: {
      kind: AgentApprovalKinds.ToolCall,
      sessionId: "session",
      requestId: "request",
      step: 1,
      toolCallId: "call",
      title: "Approve tool",
      reason: "Tool requires approval.",
      availableDecisions: [
        AgentApprovalDecisions.ApproveOnce,
        AgentApprovalDecisions.Deny,
        AgentApprovalDecisions.DenyAndInterrupt,
      ],
      subject: {
        kind: AgentApprovalKinds.ToolCall,
        toolName: "TestTool",
        arguments: {},
      },
      ...approvalOverrides,
    },
  };
}

function readApprovalId(event: AgentDomainEvent | undefined): string {
  return String(readRecord(event?.data).approvalId ?? "");
}

function readToolCallId(event: AgentDomainEvent | undefined): string {
  return String(readRecord(event?.data).toolCallId ?? "");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
