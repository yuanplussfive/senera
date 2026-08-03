import { describe, expect, test, vi } from "vitest";
import type { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import type { AgentToolPermissionGate } from "../../../Source/AgentSystem/Safety/AgentToolPermissionGate.js";
import { AgentPiToolPermissionHook } from "../../../Source/AgentSystem/Pi/AgentPiToolPermissionHook.js";
import { toolAccessGrant } from "../Support/AgentTestFixtures.js";
import { AgentPiTurnContextRegistry } from "../../../Source/AgentSystem/PiShared/AgentPiTurnContext.js";

const turnContexts = new AgentPiTurnContextRegistry();

describe("Pi tool permission hook behavior", () => {
  test("blocks a registered request that is outside the authoritative access grant", async () => {
    const authorize = vi.fn();
    const hook = new AgentPiToolPermissionHook({
      registry: { getTool: () => ({ name: "ToolB" }) } as unknown as AgentExtensionRegistry,
      permissionGate: { authorize } as unknown as AgentToolPermissionGate,
      turnContexts,
    });

    const result = await hook.authorize(
      {
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
      turnContexts,
    });

    await hook.authorize(
      {
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
});
