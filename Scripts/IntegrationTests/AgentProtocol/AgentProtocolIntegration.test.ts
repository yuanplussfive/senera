import { afterEach, describe, expect, test } from "vitest";
import { AgentApprovalRuntime } from "../../../Source/AgentSystem/Approvals/AgentApprovalRuntime.js";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEventCatalog.js";
import {
  AgentProtocolIntegrationClient,
  createAgentProtocolIntegrationHarness,
  type AgentProtocolIntegrationHarness,
} from "./AgentProtocolIntegrationHarness.js";

const openHarnesses: AgentProtocolIntegrationHarness[] = [];

afterEach(async () => {
  const stops: Promise<void>[] = [];
  while (openHarnesses.length > 0) {
    const harness = openHarnesses.pop();
    if (harness) stops.push(harness.stop());
  }
  await Promise.allSettled(stops);
});

describe("agent protocol integration", () => {
  test("dispatches approval resolution on the same websocket while a run is waiting", async () => {
    const approvalRuntime = new AgentApprovalRuntime({ defaultDeadlineMs: 5_000 });
    const harness = await createAgentProtocolIntegrationHarness(
      async (request) => {
        const resolution = await approvalRuntime.requestApproval({
          approval: {
            kind: "tool_call",
            sessionId: request.sessionId ?? "e2e-session",
            requestId: request.requestId ?? "e2e-approval-request",
            step: 1,
            title: "E2E approval",
            reason: "Verify same-socket approval dispatch.",
            availableDecisions: ["approve_once"],
            subject: {
              kind: "tool_call",
              toolName: "E2ETool",
              arguments: {},
            },
          },
          onEvent: request.onEvent,
          signal: request.signal,
        });
        if (resolution.status !== "approved") {
          throw new Error(`Approval did not proceed: ${resolution.status}`);
        }
        await request.onEvent?.({
          kind: AgentEventKinds.RunCompleted,
          context: { requestId: request.requestId },
          data: {},
        });
        return {
          terminal: { kind: "FinalAnswer", content: "approved" },
          decisionXml: "<FinalAnswer><answer>approved</answer></FinalAnswer>",
          conversationEntries: [],
          executedTools: [],
          stepTraces: [],
        };
      },
      { approvalRuntime },
    );
    openHarnesses.push(harness);
    const sessionId = "session_e2e_same_socket_approval";
    const requestId = "request_e2e_same_socket_approval";

    harness.client.send({
      type: "session.message",
      sessionId,
      requestId,
      input: "需要审批",
      disposition: "create_if_missing",
    });
    const requested = await harness.client.waitForEvent(
      AgentEventKinds.ApprovalRequested,
      (event) => event.sessionId === sessionId && event.requestId === requestId,
    );
    const approvalId = readDataRecord(requested).approvalId;
    expect(approvalId).toEqual(expect.any(String));

    harness.client.send({
      type: "approval.resolve",
      approvalId: approvalId as string,
      decision: "approve_once",
    });
    await harness.client.waitForEvent(
      AgentEventKinds.ApprovalResolved,
      (event) => event.sessionId === sessionId && event.requestId === requestId,
      { timeoutMs: 1_000 },
    );
    await harness.client.waitForEvent(
      AgentEventKinds.RunCompleted,
      (event) => event.sessionId === sessionId && event.requestId === requestId,
      { timeoutMs: 1_000 },
    );
  });

  test("dispatches cancellation on the same websocket while a run is waiting", async () => {
    const harness = await createHarness(async (request) => {
      await new Promise<void>((resolve) => {
        if (request.signal?.aborted) {
          resolve();
          return;
        }
        request.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      throw request.signal?.reason ?? new Error("run cancelled");
    });
    const sessionId = "session_e2e_same_socket_cancel";
    const requestId = "request_e2e_same_socket_cancel";

    harness.client.send({
      type: "session.message",
      sessionId,
      requestId,
      input: "等待取消",
      disposition: "create_if_missing",
    });
    await harness.client.waitForEvent(AgentEventKinds.RunStarted, (event) => event.sessionId === sessionId);

    harness.client.send({ type: "session.cancel", sessionId });
    await harness.client.waitForEvent(
      AgentEventKinds.RunCancelled,
      (event) => event.sessionId === sessionId && event.requestId === requestId,
      { timeoutMs: 1_000 },
    );
  });

  test("websocket session message emits run lifecycle and replayable history", async () => {
    const harness = await createHarness();
    const sessionId = "session_e2e_direct";
    const requestId = "request_e2e_direct";

    harness.client.send({
      type: "session.message",
      sessionId,
      requestId,
      input: "检查协议链路",
      disposition: "create_if_missing",
    });
    await harness.client.waitForEvent(AgentEventKinds.SessionCreated, (event) => event.sessionId === sessionId);
    await harness.client.waitForKinds([
      AgentEventKinds.RunStarted,
      AgentEventKinds.ModelStarted,
      AgentEventKinds.ModelDelta,
      AgentEventKinds.AssistantMessageCreated,
      AgentEventKinds.RunCompleted,
    ]);

    const finalAnswer = await harness.client.waitForEvent(
      AgentEventKinds.AssistantMessageCreated,
      (event) =>
        event.requestId === requestId &&
        readDataRecord(event).kind === "final_answer" &&
        readDataRecord(event).content === "E2E response: 检查协议链路",
    );
    expect(finalAnswer.sessionId).toBe(sessionId);
    expect(finalAnswer.phase).toBe("run");

    harness.client.send({ type: "session.history", sessionId, refresh: true });
    await harness.client.waitForKinds(
      [
        AgentEventKinds.SessionHistoryStarted,
        AgentEventKinds.SessionHistoryChunk,
        AgentEventKinds.SessionHistorySteps,
        AgentEventKinds.SessionRunHistoryChunk,
        AgentEventKinds.SessionHistoryCompleted,
      ],
      { afterSequence: finalAnswer.sequence },
    );
    const historyChunk = await harness.client.waitForEvent(
      AgentEventKinds.SessionHistoryChunk,
      (event) => event.sessionId === sessionId && JSON.stringify(event.data).includes("检查协议链路"),
      { afterSequence: finalAnswer.sequence },
    );
    expect(readDataRecord(historyChunk).entries).toEqual(expect.any(Array));
  });

  test("provider model changes notify sibling clients to refresh the chat model catalog", async () => {
    const harness = await createHarness();
    const sibling = await AgentProtocolIntegrationClient.connect(harness.websocketUrl);
    try {
      const siblingSequence = sibling.snapshot().at(-1)?.sequence ?? 0;
      const commandId = "command_e2e_model_sync";

      harness.client.send({
        type: "provider.model.upsert",
        commandId,
        model: {
          Id: "e2e-added-model",
          ProviderId: "e2e",
          Endpoint: "ChatCompletions",
          Model: "senera-e2e-added",
        },
      });

      await harness.client.waitForEvent(
        AgentEventKinds.ConfigSnapshot,
        (event) => readOperationCommandId(event) === commandId,
      );
      const reloaded = await sibling.waitForEvent(AgentEventKinds.ConfigReloaded, undefined, {
        afterSequence: siblingSequence,
      });

      sibling.send({ type: "model.list" });
      const catalog = await sibling.waitForEvent(AgentEventKinds.ModelListSnapshot, undefined, {
        afterSequence: reloaded.sequence,
      });
      expect(JSON.stringify(readDataRecord(catalog))).toContain("e2e-added-model");
    } finally {
      sibling.close();
    }
  });

  test("invalid websocket payload is rejected without closing the connection", async () => {
    const harness = await createHarness();
    const before = harness.client.snapshot().at(-1)?.sequence ?? 0;

    harness.client.send({ type: "session.list" });
    await harness.client.waitForEvent(AgentEventKinds.SessionListSnapshot, undefined, { afterSequence: before });

    harness.client.send({
      type: "session.message",
      sessionId: "missing_input",
      input: "",
    });
    const invalid = await harness.client.waitForEvent(AgentEventKinds.RequestInvalid);
    expect(readDataRecord(invalid).message).toBe("WS 请求结构无效。");

    harness.client.send({ type: "sandbox.status" });
    const sandbox = await harness.client.waitForEvent(AgentEventKinds.SandboxStatusSnapshot, undefined, {
      afterSequence: invalid.sequence,
    });
    expect(readDataRecord(sandbox)).toMatchObject({
      state: "unavailable",
      effectiveMode: "unavailable",
    });
  });

  test("history replay remains isolated when multiple sessions share one websocket", async () => {
    const harness = await createHarness();
    await createCompletedSession(harness, "session_e2e_alpha", "alpha only");
    await createCompletedSession(harness, "session_e2e_beta", "beta only");

    const afterFirstSession = harness.client.snapshot().at(-1)?.sequence ?? 0;
    harness.client.send({ type: "session.list" });
    const list = await harness.client.waitForEvent(AgentEventKinds.SessionListSnapshot, undefined, {
      afterSequence: afterFirstSession,
    });
    expect(JSON.stringify(readDataRecord(list))).toContain("session_e2e_alpha");
    expect(JSON.stringify(readDataRecord(list))).toContain("session_e2e_beta");

    const afterList = list.sequence;
    harness.client.send({ type: "session.history", sessionId: "session_e2e_beta", refresh: true });
    const replay = await harness.client.waitForEvent(
      AgentEventKinds.SessionHistoryChunk,
      (event) => event.sessionId === "session_e2e_beta",
      { afterSequence: afterList },
    );
    const serializedReplay = JSON.stringify(readDataRecord(replay));
    expect(serializedReplay).toContain("beta only");
    expect(serializedReplay).not.toContain("alpha only");
  });

  test("administrator login is required before a browser-origin WebSocket can use the protocol", async () => {
    const harness = await createAgentProtocolIntegrationHarness(undefined, {
      authentication: {
        loginName: "owner",
        password: "a long administrator password",
        origin: "http://app.test",
      },
    });
    openHarnesses.push(harness);

    await expect(
      AgentProtocolIntegrationClient.connect(harness.websocketUrl, {
        headers: { Origin: "http://app.test" },
      }),
    ).rejects.toThrow();

    const before = harness.client.snapshot().at(-1)?.sequence ?? 0;
    harness.client.send({ type: "sandbox.status" });
    await expect(
      harness.client.waitForEvent(AgentEventKinds.SandboxStatusSnapshot, undefined, { afterSequence: before }),
    ).resolves.toMatchObject({
      kind: AgentEventKinds.SandboxStatusSnapshot,
    });
  });
  test("approval denial fails the waiting run without closing the websocket", async () => {
    const approvalRuntime = new AgentApprovalRuntime({ defaultDeadlineMs: 5_000 });
    const harness = await createApprovalGatedHarness(approvalRuntime, ["approve_once", "deny"]);
    const sessionId = "session_e2e_denied_approval";
    const requestId = "request_e2e_denied_approval";

    harness.client.send({
      type: "session.message",
      sessionId,
      requestId,
      input: "需要审批后拒绝",
      disposition: "create_if_missing",
    });
    const requested = await harness.client.waitForEvent(
      AgentEventKinds.ApprovalRequested,
      (event) => event.sessionId === sessionId && event.requestId === requestId,
    );

    harness.client.send({
      type: "approval.resolve",
      approvalId: readDataRecord(requested).approvalId as string,
      decision: "deny",
    });
    await harness.client.waitForEvent(
      AgentEventKinds.ApprovalResolved,
      (event) => event.sessionId === sessionId && event.requestId === requestId,
      { timeoutMs: 1_000 },
    );
    await harness.client.waitForEvent(
      AgentEventKinds.RunFailed,
      (event) => event.sessionId === sessionId && event.requestId === requestId,
      { timeoutMs: 1_000 },
    );

    const afterFailure = harness.client.snapshot().at(-1)?.sequence ?? 0;
    harness.client.send({ type: "session.list" });
    await harness.client.waitForEvent(AgentEventKinds.SessionListSnapshot, undefined, { afterSequence: afterFailure });
  });

  test("approval deadline expiry resolves the approval and fails the run without manual input", async () => {
    const approvalRuntime = new AgentApprovalRuntime({ defaultDeadlineMs: 200 });
    const harness = await createApprovalGatedHarness(approvalRuntime, ["approve_once"]);
    const sessionId = "session_e2e_expired_approval";
    const requestId = "request_e2e_expired_approval";

    harness.client.send({
      type: "session.message",
      sessionId,
      requestId,
      input: "审批等待超时",
      disposition: "create_if_missing",
    });
    await harness.client.waitForEvent(
      AgentEventKinds.ApprovalRequested,
      (event) => event.sessionId === sessionId && event.requestId === requestId,
    );

    const resolved = await harness.client.waitForEvent(
      AgentEventKinds.ApprovalResolved,
      (event) => event.sessionId === sessionId && event.requestId === requestId,
      { timeoutMs: 2_000 },
    );
    expect(JSON.stringify(resolved.data)).toContain("expired");
    await harness.client.waitForEvent(
      AgentEventKinds.RunFailed,
      (event) => event.sessionId === sessionId && event.requestId === requestId,
      { timeoutMs: 2_000 },
    );
  });

  test("concurrent runs in separate sessions on one websocket stay correctly scoped", async () => {
    const harness = await createHarness();
    const runs = [
      { sessionId: "session_e2e_parallel_alpha", requestId: "request_e2e_parallel_alpha", input: "并发甲" },
      { sessionId: "session_e2e_parallel_beta", requestId: "request_e2e_parallel_beta", input: "并发乙" },
    ] as const;

    for (const run of runs) {
      harness.client.send({
        type: "session.message",
        sessionId: run.sessionId,
        requestId: run.requestId,
        input: run.input,
        disposition: "create_if_missing",
      });
    }
    for (const run of runs) {
      const answer = await harness.client.waitForEvent(
        AgentEventKinds.AssistantMessageCreated,
        (event) => event.requestId === run.requestId && readDataRecord(event).content === `E2E response: ${run.input}`,
      );
      expect(answer.sessionId).toBe(run.sessionId);
      await harness.client.waitForEvent(AgentEventKinds.RunCompleted, (event) => event.requestId === run.requestId);
    }
    for (const run of runs) {
      const scopedEvents = harness.client.snapshot().filter((event) => event.requestId === run.requestId);
      expect(scopedEvents.length).toBeGreaterThan(0);
      expect(scopedEvents.every((event) => event.sessionId === run.sessionId)).toBe(true);
    }
  });
});

async function createApprovalGatedHarness(
  approvalRuntime: AgentApprovalRuntime,
  availableDecisions: ["approve_once", ...("deny" | "approve_once")[]],
): Promise<AgentProtocolIntegrationHarness> {
  const harness = await createAgentProtocolIntegrationHarness(
    async (request) => {
      const resolution = await approvalRuntime.requestApproval({
        approval: {
          kind: "tool_call",
          sessionId: request.sessionId ?? "e2e-session",
          requestId: request.requestId ?? "e2e-approval-request",
          step: 1,
          title: "E2E approval gate",
          reason: "Verify denial and expiry resolutions fail the run.",
          availableDecisions,
          subject: {
            kind: "tool_call",
            toolName: "E2ETool",
            arguments: {},
          },
        },
        onEvent: request.onEvent,
        signal: request.signal,
      });
      if (resolution.status !== "approved") {
        throw new Error(`Approval did not proceed: ${resolution.status}`);
      }
      return {
        terminal: { kind: "FinalAnswer", content: "approved" },
        decisionXml: "<FinalAnswer><answer>approved</answer></FinalAnswer>",
        conversationEntries: [],
        executedTools: [],
        stepTraces: [],
      };
    },
    { approvalRuntime },
  );
  openHarnesses.push(harness);
  return harness;
}

async function createHarness(
  handler?: Parameters<typeof createAgentProtocolIntegrationHarness>[0],
): Promise<AgentProtocolIntegrationHarness> {
  const harness = await createAgentProtocolIntegrationHarness(handler);
  openHarnesses.push(harness);
  return harness;
}

async function createCompletedSession(
  harness: AgentProtocolIntegrationHarness,
  sessionId: string,
  input: string,
): Promise<void> {
  const beforeCreate = harness.client.snapshot().at(-1)?.sequence ?? 0;
  harness.client.send({ type: "session.create", sessionId });
  await harness.client.waitForEvent(AgentEventKinds.SessionCreated, (event) => event.sessionId === sessionId, {
    afterSequence: beforeCreate,
  });

  const beforeMessage = harness.client.snapshot().at(-1)?.sequence ?? 0;
  harness.client.send({
    type: "session.message",
    sessionId,
    requestId: `${sessionId}:request`,
    input,
  });
  await harness.client.waitForEvent(AgentEventKinds.RunCompleted, (event) => event.sessionId === sessionId, {
    afterSequence: beforeMessage,
  });
}

function readOperationCommandId(event: { data: unknown }): string | undefined {
  const operation = readDataRecord(event).operation;
  if (!operation || typeof operation !== "object") return undefined;
  const commandId = (operation as Record<string, unknown>).commandId;
  return typeof commandId === "string" ? commandId : undefined;
}

function readDataRecord(event: { data: unknown }): Record<string, unknown> {
  expect(event.data).toEqual(expect.any(Object));
  return event.data as Record<string, unknown>;
}
