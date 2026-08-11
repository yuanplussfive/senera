import { describe, expect, test } from "vitest";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";
import { createAgentToolAccessGrant } from "../../../Source/AgentSystem/ToolRuntime/AgentToolAccessGrant.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";

describe("Pi child-run wrap-up", () => {
  test("allows Tool work until the host explicitly requests deadline consolidation", () => {
    const turnState = createTurnState();

    expect(turnState.authorizeToolTurn()).toEqual({ block: false });
    expect(turnState.requestWrapUp("child_deadline")).toBe(true);
    expect(turnState.requestWrapUp("child_deadline")).toBe(false);
    expect(turnState.authorizeToolTurn()).toMatchObject({
      block: true,
      reason: expect.stringContaining("consolidating"),
    });
  });
});

function createTurnState(): AgentPiTurnState {
  const toolAccessGrant = createAgentToolAccessGrant({
    authorizedToolNames: ["ReadTool"],
    exposedToolNames: ["ReadTool"],
    preferredToolNames: ["ReadTool"],
  });
  return new AgentPiTurnState({
    sessionId: "child-session",
    requestId: "child-request",
    step: 1,
    approvalMode: "agent",
    toolAccessGrant,
    toolExposure: new AgentToolExposureState(toolAccessGrant),
    activeSkills: [],
    usageLedger: new AgentModelUsageLedger(),
    toolPlan: new AgentPiToolPlanCoordinator(),
    tokenBudget: new AgentTurnTokenBudget({
      model: "test-model",
      contextWindowTokens: 8_192,
      outputReserveTokens: 1_024,
    }),
  });
}
