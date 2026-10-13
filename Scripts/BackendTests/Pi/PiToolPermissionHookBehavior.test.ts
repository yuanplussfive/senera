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
import { createTool } from "../ToolSearch/ToolSearchTestFixtures.js";
import { AgentBrowserNetworkPermissionId } from "../../../Source/AgentSystem/Browser/AgentBrowserUrlPolicy.js";

describe("Pi tool permission hook behavior", () => {
  test("blocks a registered request that is outside the authoritative access grant", async () => {
    const authorize = vi.fn();
    const hook = new AgentPiToolPermissionHook({
      registry: {
        getTool: () => ({ name: "ToolB", handler: { kind: "HostCapability", capability: "test.denied" } }),
      } as unknown as AgentExtensionRegistry,
      toolPlanningMode: "native",
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
      expect(request.arguments).toEqual(input);
    });
    const shell = createTool({
      name: "ShellCommandTool",
      title: "Shell command",
      summary: "Run one shell command.",
      tags: ["shell"],
      actions: ["execute"],
      targets: ["process"],
      priority: 1,
      loading: "Bootstrap",
    });
    const hook = new AgentPiToolPermissionHook({
      registry: {
        getTool: (name: string) => (name === shell.name ? shell : undefined),
      } as unknown as AgentExtensionRegistry,
      toolPlanningMode: "native",
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
    const testTool = createTool({
      name: "TestTool",
      title: "Test tool",
      summary: "Run the test tool.",
      tags: ["test"],
      actions: ["execute"],
      targets: ["test"],
      priority: 1,
      loading: "Bootstrap",
    });
    const turnState = new AgentPiTurnState({
      systemPrompt: "Test agent system context.",
      userMessage: "Test tool permission request.",
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
      registry: {
        getTool: (name: string) => (name === testTool.name ? testTool : undefined),
      } as unknown as AgentExtensionRegistry,
      toolPlanningMode: "native",
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

  test("allows an authorized Bootstrap tool without requiring dynamic exposure", async () => {
    const shell = createTool({
      name: "ShellCommandTool",
      title: "Shell command",
      summary: "Run one shell command.",
      tags: ["shell"],
      actions: ["execute"],
      targets: ["process"],
      priority: 1,
      loading: "Bootstrap",
    });
    const authorize = vi.fn(async () => ({ action: "allow" as const, rule: "test", reason: "ok", riskSignals: [] }));
    const hook = new AgentPiToolPermissionHook({
      registry: {
        getTool: (name: string) => (name === shell.name ? shell : undefined),
      } as unknown as AgentExtensionRegistry,
      toolPlanningMode: "native",
      permissionGate: { authorize } as unknown as AgentToolPermissionGate,
      executionCapabilities: () => createSeneraExecutionRuntimeCapabilities(),
      resourceCapabilities: new AgentToolResourceCapabilityRegistry(),
    });
    const grant = toolAccessGrant([shell.name], []);

    const result = await hook.authorize(
      {
        approvalMode: "agent",
        sessionId: "session-direct",
        requestId: "request-direct",
        step: 1,
        toolAccessGrant: grant,
        toolExposure: new AgentToolExposureState(grant),
      },
      { toolCallId: "call-direct", toolName: shell.name, input: {} },
    );

    expect(result).toBeUndefined();
    expect(authorize).toHaveBeenCalledOnce();
  });

  test("requires scoped approval for an explicit browser file target and passes authorization to execution", async () => {
    const browser = createTool({
      name: "BrowserOpen",
      title: "Open browser page",
      summary: "Open a browser page or local file.",
      tags: ["browser"],
      actions: ["open"],
      targets: ["browser-page"],
      priority: 1,
    });
    browser.search = {
      ...browser.search,
      Capabilities: (browser.search?.Capabilities ?? []).map((capability) => ({
        ...capability,
        Risk: { SideEffect: "network", Permission: AgentBrowserNetworkPermissionId },
      })),
    };
    const grant = toolAccessGrant([browser.name], [browser.name]);
    const turnState = new AgentPiTurnState({
      systemPrompt: "Test agent system context.",
      userMessage: "Open a local preview.",
      approvalMode: "agent",
      sessionId: "session-browser-target",
      requestId: "request-browser-target",
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
    turnState.registerToolBatch("batch-browser-target", [
      {
        toolCallId: "call-browser-target",
        toolName: browser.name,
        input: { url: "file:///C:/workspace/preview.html" },
      },
    ]);
    const authorize = vi.fn(async () => ({
      action: "allow" as const,
      rule: "approved",
      reason: "approved",
      riskSignals: [],
    }));
    const hook = new AgentPiToolPermissionHook({
      registry: {
        getTool: (name: string) => (name === browser.name ? browser : undefined),
      } as unknown as AgentExtensionRegistry,
      toolPlanningMode: "native",
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
      {
        toolCallId: "call-browser-target",
        toolName: browser.name,
        input: { url: "file:///C:/workspace/preview.html" },
      },
    );

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        mandatoryApproval: expect.objectContaining({ scope: "file:file:///C:/workspace/preview.html" }),
      }),
    );
    expect(turnState.takeBrowserTargetAuthorization("call-browser-target")).toEqual({
      scope: "file:file:///C:/workspace/preview.html",
    });
  });

  test("blocks a stale authorization entry for a tool no longer in the registry", async () => {
    const authorize = vi.fn();
    const hook = new AgentPiToolPermissionHook({
      registry: { getTool: () => undefined } as unknown as AgentExtensionRegistry,
      toolPlanningMode: "native",
      permissionGate: { authorize } as unknown as AgentToolPermissionGate,
      executionCapabilities: () => createSeneraExecutionRuntimeCapabilities(),
      resourceCapabilities: new AgentToolResourceCapabilityRegistry(),
    });

    const result = await hook.authorize(
      {
        approvalMode: "agent",
        sessionId: "session-stale-tool",
        requestId: "request-stale-tool",
        step: 1,
        toolAccessGrant: toolAccessGrant(["RemovedTool"], ["RemovedTool"]),
      },
      { toolCallId: "call-stale-tool", toolName: "RemovedTool", input: {} },
    );

    expect(result).toMatchObject({ block: true });
    expect(result?.reason).toContain("RemovedTool");
    expect(authorize).not.toHaveBeenCalled();
  });
});
