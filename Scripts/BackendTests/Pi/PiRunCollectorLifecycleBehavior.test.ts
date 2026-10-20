import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "vitest";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentPiRunCollector } from "../../../Source/AgentSystem/Pi/AgentPiRunCollector.js";
import { AgentPiToolObservationProtocol } from "../../../Source/AgentSystem/Pi/AgentPiToolObservation.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";

describe("Pi run collector tool lifecycle", () => {
  test("publishes the Pi failure when artifact finalization overturns an executor success", async () => {
    const events: AgentDomainEvent[] = [];
    const turnState = createTurnState();
    const collector = createCollector(turnState, events);

    await collector.collect(toolStarted());
    turnState.recordExecutorLifecycleStatus("call-a", "completed");
    await collector.collect(toolEnded(true));

    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.ToolCallFailed,
      AgentEventKinds.ToolCallResultDetail,
    ]);
  });

  test("does not duplicate a matching executor terminal event", async () => {
    const events: AgentDomainEvent[] = [];
    const turnState = createTurnState();
    const collector = createCollector(turnState, events);

    await collector.collect(toolStarted());
    turnState.recordExecutorLifecycleStatus("call-a", "completed");
    await collector.collect(toolEnded(false));

    expect(events.map((event) => event.kind)).toEqual([AgentEventKinds.ToolCallResultDetail]);
  });

  test("does not publish a contradictory completion after an executor failure", async () => {
    const events: AgentDomainEvent[] = [];
    const turnState = createTurnState();
    const collector = createCollector(turnState, events);

    await collector.collect(toolStarted());
    turnState.recordExecutorLifecycleStatus("call-a", "failed");
    await collector.collect(toolEnded(false));

    expect(events.map((event) => event.kind)).toEqual([AgentEventKinds.ToolCallResultDetail]);
  });

  test("observes Native tool lifecycle in order", async () => {
    const events: AgentDomainEvent[] = [];
    const observations: Array<{ callId: string; status: string }> = [];
    const turnState = createTurnState();
    const collector = new AgentPiRunCollector({
      requestId: "request-lifecycle",
      step: 1,
      turnState,
      onEvent: (event) => {
        events.push(event);
      },
      onToolExecutionObserved: (observation) => {
        observations.push({ callId: observation.callId, status: observation.status });
      },
    });

    await collector.collect(toolStarted());
    await collector.collect(toolEnded(false));

    expect(observations).toEqual([
      { callId: "call-a", status: "dispatched" },
      { callId: "call-a", status: "completed" },
    ]);
    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.ToolCallCompleted,
      AgentEventKinds.ToolCallResultDetail,
    ]);
  });

  test("projects the declared Pi tool result into the visible result event and trace", async () => {
    const events: AgentDomainEvent[] = [];
    const turnState = createTurnState();
    const collector = createCollector(turnState, events);
    const result = {
      type: AgentPiToolObservationProtocol.type,
      status: "success",
      execution_status: "completed",
      output_availability: "complete",
      compression_method: "verbatim",
      detail: {
        result: { path: "README.md", content: "Senera project documentation" },
        evidence: [],
      },
    };

    await collector.collect(toolStarted());
    await collector.collect(toolEnded(false, JSON.stringify(result)));

    const detail = events.find((event) => event.kind === AgentEventKinds.ToolCallResultDetail);
    expect(detail?.data).toMatchObject({
      value: {
        path: "README.md",
        content: "Senera project documentation",
      },
    });
    expect(JSON.stringify(detail?.data)).not.toContain(AgentPiToolObservationProtocol.type);
    expect(collector.snapshot().traces[0]?.toolResult).toMatchObject({
      path: "README.md",
      content: "Senera project documentation",
    });
  });

  test("projects the canonical Pi failure message instead of its observation envelope", async () => {
    const events: AgentDomainEvent[] = [];
    const collector = createCollector(createTurnState(), events);
    const failure = {
      type: AgentPiToolObservationProtocol.type,
      status: "failure",
      execution_status: "completed",
      output_availability: "none",
      error: {
        code: "ToolExecutionError",
        kind: "execution",
        source: "host",
        retryable: false,
        message: "Codex Search returned no citeable search results.",
      },
      detail: {
        evidence: [],
        result: { error: { message: "Codex Search returned no citeable search results." } },
      },
    };
    const attributed = `<observation attribution="tool">${JSON.stringify(failure).replaceAll('"', "&quot;")}</observation>`;

    await collector.collect(toolStarted());
    await collector.collect(toolEnded(true, attributed));

    const lifecycle = events.find((event) => event.kind === AgentEventKinds.ToolCallFailed);
    expect(lifecycle?.data).toMatchObject({ message: "Codex Search returned no citeable search results." });
    expect(JSON.stringify(lifecycle?.data)).not.toContain("<observation attribution=");
    expect(collector.snapshot().traces[0]?.toolErrorMessage).toBe("Codex Search returned no citeable search results.");
  });
});

function createCollector(turnState: AgentPiTurnState, events: AgentDomainEvent[]): AgentPiRunCollector {
  return new AgentPiRunCollector({
    requestId: "request-lifecycle",
    step: 1,
    turnState,
    onEvent: (event) => {
      events.push(event);
    },
  });
}

function createTurnState(): AgentPiTurnState {
  const grant = createAgentToolAccessGrant({
    authorizedToolNames: ["TestTool"],
    exposedToolNames: ["TestTool"],
  });
  const turnState = new AgentPiTurnState({
    systemPrompt: "Test agent system context.",
    userMessage: "Test lifecycle request.",
    approvalMode: "agent",
    requestId: "request-lifecycle",
    step: 1,
    toolAccessGrant: grant,
    toolExposure: new AgentToolExposureState(grant),
    activeSkills: [],
    usageLedger: new AgentModelUsageLedger(),
    toolPlan: new AgentPiToolPlanCoordinator(),
    tokenBudget: new AgentTurnTokenBudget({
      model: "test-model",
      contextWindowTokens: 16_384,
      outputReserveTokens: 1_024,
    }),
  });
  turnState.registerToolBatch("batch-a", [{ toolCallId: "call-a", toolName: "TestTool", input: {} }]);
  return turnState;
}

function toolStarted(): AgentSessionEvent {
  return {
    type: "tool_execution_start",
    toolCallId: "call-a",
    toolName: "TestTool",
    args: {},
  } as AgentSessionEvent;
}

function toolEnded(isError: boolean, text?: string): AgentSessionEvent {
  return {
    type: "tool_execution_end",
    toolCallId: "call-a",
    toolName: "TestTool",
    result: {
      content: [{ type: "text", text: text ?? (isError ? "Artifact finalization failed." : "ok") }],
    },
    isError,
  } as AgentSessionEvent;
}
