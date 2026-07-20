import { describe, expect, test, vi } from "vitest";
import type { AgentPluginRegistry } from "../../../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import type { AgentToolPermissionGate } from "../../../Source/AgentSystem/Safety/AgentToolPermissionGate.js";
import { AgentPiToolPermissionHook } from "../../../Source/AgentSystem/Pi/AgentPiToolPermissionHook.js";

describe("Pi tool permission hook behavior", () => {
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
      registry: { getTool: () => undefined } as unknown as AgentPluginRegistry,
      permissionGate: { authorize } as unknown as AgentToolPermissionGate,
    });

    await hook.authorize(
      { sessionId: "session-a", requestId: "request-a", step: 1 },
      { toolCallId: "call-a", toolName: "ShellCommandTool", input },
    );

    expect(authorize).toHaveBeenCalledOnce();
    expect(input).toEqual(snapshot);
  });
});
