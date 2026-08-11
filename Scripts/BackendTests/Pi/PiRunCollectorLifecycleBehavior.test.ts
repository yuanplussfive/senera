import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "vitest";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentPiRunCollector } from "../../../Source/AgentSystem/Pi/AgentPiRunCollector.js";
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

function toolEnded(isError: boolean): AgentSessionEvent {
  return {
    type: "tool_execution_end",
    toolCallId: "call-a",
    toolName: "TestTool",
    result: {
      content: [{ type: "text", text: isError ? "Artifact finalization failed." : "ok" }],
    },
    isError,
  } as AgentSessionEvent;
}
