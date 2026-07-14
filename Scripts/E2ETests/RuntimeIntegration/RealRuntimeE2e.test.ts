import { afterEach, describe, expect, test } from "vitest";
import { AgentEventKinds } from "../../../Source/AgentSystem/Events/AgentEventCatalog.js";
import {
  createRealRuntimeE2eHarness,
  RealRuntimeE2eValues,
  type RealRuntimeE2eHarness,
} from "./RealRuntimeE2eHarness.js";

const openHarnesses: RealRuntimeE2eHarness[] = [];

afterEach(async () => {
  await Promise.all(openHarnesses.splice(0).map((harness) => harness.stop()));
});

describe("real runtime E2E", () => {
  test("runs BAML planning, Pi proxy model streaming, a host tool, and persisted session replay", async () => {
    const harness = await createRealRuntimeE2eHarness();
    openHarnesses.push(harness);
    const sessionId = "session_real_runtime_e2e";
    const requestId = "request_real_runtime_e2e";

    harness.client.send({ type: "session.create", sessionId });
    await harness.client.waitForEvent(AgentEventKinds.SessionCreated, (event) => event.sessionId === sessionId);
    harness.client.send({
      type: "session.message",
      sessionId,
      requestId,
      input: RealRuntimeE2eValues.RequestInput,
    });

    const toolCompleted = await harness.client.waitForEvent(
      AgentEventKinds.ToolCallCompleted,
      (event) => event.requestId === requestId && readData(event).toolName === RealRuntimeE2eValues.ToolName,
      { timeoutMs: 20_000 },
    );
    const finalAnswer = await harness.client.waitForEvent(
      AgentEventKinds.AssistantMessageCreated,
      (event) => event.requestId === requestId && readData(event).content === RealRuntimeE2eValues.FinalAnswer,
      { timeoutMs: 20_000, afterSequence: toolCompleted.sequence },
    );
    await harness.client.waitForEvent(AgentEventKinds.RunCompleted, (event) => event.requestId === requestId, {
      timeoutMs: 20_000,
      afterSequence: finalAnswer.sequence,
    });

    expect(harness.modelServer.stages).toEqual(
      expect.arrayContaining(["understandUserTurn", "routeInteraction", "selectPiAction"]),
    );
    expect(harness.modelServer.count("selectPiAction")).toBe(2);

    harness.client.send({ type: "session.history", sessionId, refresh: true });
    const history = await harness.client.waitForEvent(
      AgentEventKinds.SessionHistoryChunk,
      (event) => event.sessionId === sessionId && JSON.stringify(event.data).includes(RealRuntimeE2eValues.FinalAnswer),
      { afterSequence: finalAnswer.sequence },
    );
    expect(JSON.stringify(history.data)).toContain(RealRuntimeE2eValues.RequestInput);
  }, 30_000);
});

function readData(event: { data: unknown }): Record<string, unknown> {
  return event.data as Record<string, unknown>;
}
