import { afterEach, describe, expect, test } from "vitest";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEventCatalog.js";
import {
  AgentProtocolE2eClient,
  createAgentProtocolE2eHarness,
  type AgentProtocolE2eHarness,
} from "./AgentProtocolE2eHarness.js";

const openHarnesses: AgentProtocolE2eHarness[] = [];

afterEach(() => {
  while (openHarnesses.length > 0) {
    openHarnesses.pop()?.stop();
  }
});

describe("agent protocol E2E", () => {
  test("websocket session message emits run lifecycle and replayable history", async () => {
    const harness = await createHarness();
    const sessionId = "session_e2e_direct";
    const requestId = "request_e2e_direct";

    harness.client.send({ type: "session.create", sessionId });
    await harness.client.waitForEvent(AgentEventKinds.SessionCreated, (event) => event.sessionId === sessionId);

    harness.client.send({
      type: "session.message",
      sessionId,
      requestId,
      input: "检查协议链路",
    });
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
    const sibling = await AgentProtocolE2eClient.connect(harness.websocketUrl);
    try {
      const siblingSequence = sibling.snapshot().at(-1)?.sequence ?? 0;
      const requestId = "request_e2e_model_sync";

      harness.client.send({
        type: "provider.model.upsert",
        requestId,
        expectedRevision: 1,
        model: {
          Id: "e2e-added-model",
          ProviderId: "e2e",
          Endpoint: "ChatCompletions",
          Model: "senera-e2e-added",
        },
      });

      await harness.client.waitForEvent(
        AgentEventKinds.ConfigSnapshot,
        (event) => readOperationRequestId(event) === requestId,
      );
      const reloaded = await sibling.waitForEvent(
        AgentEventKinds.ConfigReloaded,
        undefined,
        { afterSequence: siblingSequence },
      );

      sibling.send({ type: "model.list" });
      const catalog = await sibling.waitForEvent(
        AgentEventKinds.ModelListSnapshot,
        undefined,
        { afterSequence: reloaded.sequence },
      );
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
    expect(readDataRecord(sandbox).state).toBe("fallback");
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
    const harness = await createAgentProtocolE2eHarness(undefined, {
      authentication: {
        loginName: "owner",
        password: "a long administrator password",
        origin: "http://app.test",
      },
    });
    openHarnesses.push(harness);

    await expect(
      AgentProtocolE2eClient.connect(harness.websocketUrl, {
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
});

async function createHarness(): Promise<AgentProtocolE2eHarness> {
  const harness = await createAgentProtocolE2eHarness();
  openHarnesses.push(harness);
  return harness;
}

async function createCompletedSession(
  harness: AgentProtocolE2eHarness,
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

function readOperationRequestId(event: { data: unknown }): string | undefined {
  const operation = readDataRecord(event).operation;
  if (!operation || typeof operation !== "object") return undefined;
  const requestId = (operation as Record<string, unknown>).requestId;
  return typeof requestId === "string" ? requestId : undefined;
}

function readDataRecord(event: { data: unknown }): Record<string, unknown> {
  expect(event.data).toEqual(expect.any(Object));
  return event.data as Record<string, unknown>;
}
