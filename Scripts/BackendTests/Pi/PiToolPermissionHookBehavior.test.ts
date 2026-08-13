import { describe, expect, test, vi } from "vitest";
import type { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import type { AgentToolPermissionGate } from "../../../Source/AgentSystem/Safety/AgentToolPermissionGate.js";
import { AgentPiToolPermissionHook } from "../../../Source/AgentSystem/Pi/AgentPiToolPermissionHook.js";
import { toolAccessGrant } from "../Support/AgentTestFixtures.js";
import { createSeneraExecutionRuntimeCapabilities } from "../../../Source/AgentSystem/Execution/SeneraExecutionRuntimeCapabilities.js";
import { AgentToolResourceCapabilityRegistry } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceCapabilityRegistry.js";
import { AgentPiTurnState } from "../../../Source/AgentSystem/Pi/AgentPiTurnState.js";
import { AgentToolExposureState } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExposureState.js";
import { AgentModelUsageLedger } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelUsage.js";
import { AgentPiToolPlanCoordinator } from "../../../Source/AgentSystem/PiShared/AgentPiToolPlanCoordinator.js";
import { AgentTurnTokenBudget } from "../../../Source/AgentSystem/Text/AgentTurnTokenBudget.js";

describe("Pi tool permission hook behavior", () => {
  test("blocks a registered request that is outside the authoritative access grant", async () => {
    const authorize = vi.fn();
    const hook = new AgentPiToolPermissionHook({
      registry: { getTool: () => ({ name: "ToolB" }) } as unknown as AgentExtensionRegistry,
      permissionGate: { authorize } as unknown as AgentToolPermissionGate,
      executionCapabilities: () => createSeneraExecutionRuntimeCapabilities(),
      resourceCapabilities: new AgentToolResourceCapabilityRegistry(),
    });

    const result = await hook.authorize(
      {
        approvalMode: "agent",
        requestId: "request-denied",
        toolAccessGrant: toolAccessGrant(["ToolA"], ["ToolA"]),
      },
      { toolCallId: "call-denied", toolName: "ToolB", input: {} },
    );

    expect(result).toMatchObject({ block: true });
    expect(result?.reason).toContain("ToolB");
    expect(authorize).not.toHaveBeenCalled();
  });

  test("passes secret-like shell arguments through without mutation or conversion", async () => {
    const input = {
      command: {
        dialect: "powershell" as const,
        script: "$env:OPENAI_API_KEY='sk-test-visible-value'; Invoke-RestMethod https://example.test",
      },
      cwd: "C:/workspace",
    };
    const snapshot = structuredClone(input);
    const authorize = vi.fn(async (request) => {
      expect(request.arguments).toBe(input);
    });
    const hook = new AgentPiToolPermissionHook({
      registry: { getTool: () => undefined } as unknown as AgentExtensionRegistry,
      permissionGate: { authorize } as unknown as AgentToolPermissionGate,
      executionCapabilities: () => createSeneraExecutionRuntimeCapabilities(),
      resourceCapabilities: new AgentToolResourceCapabilityRegistry(),
    });

    await hook.authorize(
      {
        approvalMode: "agent",
        sessionId: "session-a",
        requestId: "request-a",
        step: 1,
        toolAccessGrant: toolAccessGrant(["ShellCommandTool"], ["ShellCommandTool"]),
      },
      { toolCallId: "call-a", toolName: "ShellCommandTool", input },
    );

    expect(authorize).toHaveBeenCalledOnce();
    expect(input).toEqual(snapshot);
  });

  test("uses the active turn state as the approval-mode authority", async () => {
    const grant = toolAccessGrant(["TestTool"], ["TestTool"]);
    const turnState = new AgentPiTurnState({
      approvalMode: "agent",
      sessionId: "session-turn-mode",
      requestId: "request-turn-mode",
      step: 1,
      toolAccessGrant: grant,
      toolExposure: new AgentToolExposureState(grant),
      activeSkills: [],
      usageLedger: new AgentModelUsageLedger(),
      toolPlan: new AgentPiToolPlanCoordinator(),
      tokenBudget: new AgentTurnTokenBudget({
        model: "test-model",
        contextWindowTokens: 8_192,
        outputReserveTokens: 1_024,
      }),
    });
    turnState.registerToolBatch("batch-turn-mode", [{ toolCallId: "call-turn-mode", toolName: "TestTool", input: {} }]);
    const authorize = vi.fn(async () => ({ action: "allow" as const, rule: "test", reason: "ok", riskSignals: [] }));
    const hook = new AgentPiToolPermissionHook({
      registry: { getTool: () => undefined } as unknown as AgentExtensionRegistry,
      permissionGate: { authorize } as unknown as AgentToolPermissionGate,
      executionCapabilities: () => createSeneraExecutionRuntimeCapabilities(),
      resourceCapabilities: new AgentToolResourceCapabilityRegistry(),
    });

    await hook.authorize(
      {
        turnState,
        toolAccessGrant: grant,
        toolExposure: turnState.context.toolExposure,
      },
      { toolCallId: "call-turn-mode", toolName: "TestTool", input: {} },
    );

    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ approvalMode: "agent" }));
  });
});
