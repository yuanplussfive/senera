import { describe, expect, test } from "vitest";
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentPiTerminalToolObservationProjector } from "../../../Source/AgentSystem/Pi/AgentPiTerminalToolObservation.js";
import { readAgentPiToolObservation } from "../../../Source/AgentSystem/Pi/AgentPiToolObservation.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { toolAccessGrant } from "../Support/AgentTestFixtures.js";

describe("Pi terminal tool observations", () => {
  test("projects a Pi validation failure and settles its unclaimed reservation", () => {
    const turnState = createTurnState();
    turnState.registerToolBatch("batch-validation", [
      { toolCallId: "call-validation", toolName: "ArtifactReadTool", input: {} },
    ]);
    const projector = new AgentPiTerminalToolObservationProjector("test-model");

    projector.settle(turnState, {
      toolCallId: "call-validation",
      toolName: "ArtifactReadTool",
      result: { content: [{ type: "text", text: "Validation failed: refs must be array" }] },
      isError: true,
    });
    const replacement = projector.replaceMessage({
      role: "toolResult",
      toolCallId: "call-validation",
      toolName: "ArtifactReadTool",
      content: [{ type: "text", text: "legacy plain error" }],
      details: {},
      isError: true,
      timestamp: Date.now(),
    });

    expect(replacement?.role).toBe("toolResult");
    const content = replacement?.role === "toolResult" ? replacement.content[0] : undefined;
    const observation = content?.type === "text" ? readAgentPiToolObservation(content.text) : undefined;
    expect(observation).toMatchObject({
      status: "failure",
      execution_status: "not_started",
      output_availability: "none",
      error: { code: "pi_tool_call_rejected", source: "pi" },
    });
    expect(() => turnState.context.tokenBudget.validateModelInput({ messages: [replacement] })).not.toThrow();
  });
});

function createTurnState(): AgentPiTurnState {
  const grant = toolAccessGrant(["ArtifactReadTool"]);
  const tokenBudget = new AgentTurnTokenBudget({
    model: "test-model",
    contextWindowTokens: 8_192,
    outputReserveTokens: 1_024,
  });
  tokenBudget.validateModelInput({ messages: [] });
  return new AgentPiTurnState({
    approvalMode: "agent",
    requestId: "request-validation",
    step: 1,
    toolAccessGrant: grant,
    toolExposure: new AgentToolExposureState(grant),
    activeSkills: [],
    usageLedger: new AgentModelUsageLedger(),
    toolPlan: new AgentPiToolPlanCoordinator(),
    tokenBudget,
  });
}
