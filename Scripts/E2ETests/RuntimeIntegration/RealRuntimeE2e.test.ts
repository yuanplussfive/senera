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
  test("runs only the latest regeneration while replacing an active Pi provider turn", async () => {
    const harness = await createRealRuntimeE2eHarness();
    openHarnesses.push(harness);
    const sessionId = "session_real_runtime_active_regeneration_e2e";
    const requestId = "request_real_runtime_active_regeneration_e2e";
    const firstReplacementRequestId = `${requestId}_replacement_1`;
    const replacementRequestId = `${requestId}_replacement_2`;
    const pausedFinalAnswer = harness.modelServer.pauseNext("generatePiFinalAnswer");

    harness.client.send({
      type: "session.message",
      sessionId,
      requestId,
      input: RealRuntimeE2eValues.DirectRequestInput,
      disposition: "create_if_missing",
    });
    await pausedFinalAnswer.entered;

    harness.client.send({
      type: "session.regenerate",
      sessionId,
      fromRequestId: requestId,
      requestId: firstReplacementRequestId,
      input: RealRuntimeE2eValues.DirectRequestInput,
    });
    harness.client.send({
      type: "session.regenerate",
      sessionId,
      fromRequestId: requestId,
      requestId: replacementRequestId,
      input: RealRuntimeE2eValues.DirectRequestInput,
    });
    await harness.client.waitForEvent(
      AgentEventKinds.RunCancelled,
      (event) => event.requestId === firstReplacementRequestId,
      { timeoutMs: 20_000 },
    );
    const truncated = await harness.client.waitForEvent(
      AgentEventKinds.SessionTruncated,
      (event) => event.sessionId === sessionId && readData(event).fromRequestId === requestId,
      { timeoutMs: 20_000 },
    );
    const replacementStarted = await harness.client.waitForEvent(
      AgentEventKinds.RunStarted,
      (event) => event.requestId === replacementRequestId,
      { timeoutMs: 20_000, afterSequence: truncated.sequence },
    );
    const replacementAnswer = await harness.client.waitForEvent(
      AgentEventKinds.AssistantMessageCreated,
      (event) =>
        event.requestId === replacementRequestId && readData(event).content === RealRuntimeE2eValues.DirectFinalAnswer,
      { timeoutMs: 20_000, afterSequence: replacementStarted.sequence },
    );
    await harness.client.waitForEvent(
      AgentEventKinds.RunCompleted,
      (event) => event.requestId === replacementRequestId,
      {
        timeoutMs: 20_000,
        afterSequence: replacementAnswer.sequence,
      },
    );
    pausedFinalAnswer.release();

    expect(harness.modelServer.count("prepareInteraction")).toBe(1);
    expect(harness.modelServer.count("generatePiFinalAnswer")).toBe(2);
    expect(
      harness.client
        .snapshot()
        .filter((event) => event.kind === AgentEventKinds.AssistantMessageCreated)
        .map((event) => event.requestId),
    ).toEqual([replacementRequestId]);
  }, 30_000);

  test("reuses the Pi session and bypasses duplicate action selection for authoritative direct responses", async () => {
    const harness = await createRealRuntimeE2eHarness();
    openHarnesses.push(harness);
    const sessionId = "session_real_runtime_direct_e2e";
    const requestId = "request_real_runtime_direct_e2e";

    harness.client.send({
      type: "session.message",
      sessionId,
      requestId,
      input: RealRuntimeE2eValues.DirectRequestInput,
      disposition: "create_if_missing",
    });
    await harness.client.waitForEvent(AgentEventKinds.SessionCreated, (event) => event.sessionId === sessionId);

    const answer = await harness.client.waitForEvent(
      AgentEventKinds.AssistantMessageCreated,
      (event) => event.requestId === requestId && readData(event).content === RealRuntimeE2eValues.DirectFinalAnswer,
      { timeoutMs: 20_000 },
    );
    await harness.client.waitForEvent(AgentEventKinds.RunCompleted, (event) => event.requestId === requestId, {
      timeoutMs: 20_000,
      afterSequence: answer.sequence,
    });
    const followUpRequestId = `${requestId}_follow_up`;
    harness.client.send({
      type: "session.message",
      sessionId,
      requestId: followUpRequestId,
      input: RealRuntimeE2eValues.DirectRequestInput,
    });
    const followUpAnswer = await harness.client.waitForEvent(
      AgentEventKinds.AssistantMessageCreated,
      (event) =>
        event.requestId === followUpRequestId && readData(event).content === RealRuntimeE2eValues.DirectFinalAnswer,
      { timeoutMs: 20_000 },
    );
    await harness.client.waitForEvent(AgentEventKinds.RunCompleted, (event) => event.requestId === followUpRequestId, {
      timeoutMs: 20_000,
      afterSequence: followUpAnswer.sequence,
    });
    const regeneratedRequestId = `${requestId}_regenerated`;
    harness.client.send({
      type: "session.regenerate",
      sessionId,
      fromRequestId: requestId,
      requestId: regeneratedRequestId,
      input: RealRuntimeE2eValues.DirectRequestInput,
    });
    const truncated = await harness.client.waitForEvent(
      AgentEventKinds.SessionTruncated,
      (event) => event.sessionId === sessionId && readData(event).fromRequestId === requestId,
      { timeoutMs: 20_000 },
    );
    const regeneratedStarted = await harness.client.waitForEvent(
      AgentEventKinds.RunStarted,
      (event) => event.requestId === regeneratedRequestId,
      { timeoutMs: 20_000, afterSequence: truncated.sequence },
    );
    const regeneratedAnswer = await harness.client.waitForEvent(
      AgentEventKinds.AssistantMessageCreated,
      (event) =>
        event.requestId === regeneratedRequestId && readData(event).content === RealRuntimeE2eValues.DirectFinalAnswer,
      { timeoutMs: 20_000, afterSequence: regeneratedStarted.sequence },
    );
    await harness.client.waitForEvent(
      AgentEventKinds.RunCompleted,
      (event) => event.requestId === regeneratedRequestId,
      {
        timeoutMs: 20_000,
        afterSequence: regeneratedAnswer.sequence,
      },
    );
    const leaseSources = harness.client
      .snapshot()
      .filter(
        (event) => event.kind === AgentEventKinds.PiTrace && readData(event).eventType === "core.turn.lease.completed",
      )
      .map((event) => readRecord(readData(event).payload)?.sessionOpenSource);

    expect(harness.modelServer.count("prepareInteraction")).toBe(2);
    expect(harness.modelServer.count("selectPiAction")).toBe(0);
    expect(harness.modelServer.count("generatePiFinalAnswer")).toBe(3);
    expect(leaseSources).toEqual(["session_store", "harness_pool", "harness_pool"]);
  }, 30_000);

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
    const modelTiming = await harness.client.waitForEvent(
      AgentEventKinds.PiTrace,
      (event) => {
        const data = readData(event);
        const payload = readRecord(data.payload);
        return (
          event.requestId === requestId &&
          data.eventType === "model_timing" &&
          payload?.stage === "SelectPiAction" &&
          typeof payload.firstTokenMs === "number"
        );
      },
      { timeoutMs: 20_000 },
    );
    expect(harness.modelServer.stages).toEqual(expect.arrayContaining(["prepareInteraction", "selectPiAction"]));
    expect(harness.modelServer.count("selectPiAction")).toBe(1);
    expect(harness.modelServer.count("generatePiFinalAnswer")).toBe(1);

    harness.client.send({ type: "session.history", sessionId, refresh: true });
    const history = await harness.client.waitForEvent(
      AgentEventKinds.SessionHistoryChunk,
      (event) => event.sessionId === sessionId && JSON.stringify(event.data).includes(RealRuntimeE2eValues.FinalAnswer),
      { afterSequence: finalAnswer.sequence },
    );
    expect(JSON.stringify(history.data)).toContain(RealRuntimeE2eValues.RequestInput);
    expect(JSON.stringify(history.data)).toContain('"source":"provider_reported"');
    expect(JSON.stringify(history.data)).toContain('"totalTokens":440');
    expect(JSON.stringify(history.data)).toContain('"stage":"PrepareInteraction"');
    expect(JSON.stringify(history.data)).toContain('"stage":"AuditToolRisk"');
    expect(JSON.stringify(history.data)).toContain('"stage":"GeneratePiFinalAnswer"');
    expect(readRecord(readData(modelTiming).payload)?.firstTokenMs).toEqual(expect.any(Number));
  }, 30_000);
});

function readData(event: { data: unknown }): Record<string, unknown> {
  return event.data as Record<string, unknown>;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
