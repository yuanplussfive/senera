import { describe, expect, it } from "vitest";
import {
  explainUnsupportedAgentToolRuntime,
  resolveAgentToolRuntimeCapabilities,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolRuntimeCapabilities.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";

describe("tool runtime capabilities", () => {
  it("accepts persistent host capabilities", () => {
    const tool = runtimeTool("HostCapability", "Persistent");

    expect(explainUnsupportedAgentToolRuntime(tool)).toEqual([]);
    expect(resolveAgentToolRuntimeCapabilities(tool)).toEqual(
      expect.objectContaining({ lifecycle: "persistent", scheduling: "parallel" }),
    );
  });

  it("projects only explicit scheduling overrides", () => {
    const resourceTool = runtimeTool("HostCapability", "Immediate");
    resourceTool.runtime.Scheduling = "ResourceClaims";
    const selfManagedTool = runtimeTool("HostCapability", "Immediate");
    selfManagedTool.runtime.Scheduling = "SelfManaged";

    expect(resolveAgentToolRuntimeCapabilities(resourceTool).scheduling).toBe("resource-claims");
    expect(resolveAgentToolRuntimeCapabilities(selfManagedTool).scheduling).toBe("self-managed");
  });

  it("does not require repeated execution protocol declarations", () => {
    const tool = runtimeTool("HostCapability", "Immediate");

    expect(explainUnsupportedAgentToolRuntime(tool)).toEqual([]);
  });

  it("accepts one-shot MCP tools only when they use the native MCP protocol", () => {
    expect(explainUnsupportedAgentToolRuntime(runtimeTool("McpTool", "OneShot"))).toEqual([]);
  });

  it("accepts persistent MCP lifecycle", () => {
    expect(explainUnsupportedAgentToolRuntime(runtimeTool("McpTool", "Persistent"))).toEqual([]);
  });
});

function runtimeTool(
  handlerKind: RegisteredTool["handler"]["kind"],
  lifecycle: NonNullable<RegisteredTool["runtime"]>["Lifecycle"],
): RegisteredTool {
  const handler =
    handlerKind === "HostCapability"
      ? ({ kind: handlerKind, capability: "test" } as const)
      : ({
          kind: handlerKind,
          server: {
            id: "test",
            revision: "test",
            command: process.execPath,
            args: [],
            cwd: process.cwd(),
          },
          tool: "test",
          readOnly: false,
          resources: [],
        } as const);
  return {
    owner: {
      kind: handlerKind === "HostCapability" ? "system" : "mcp",
      name: "test-runtime",
      rootPath: process.cwd(),
      revision: "test",
      trusted: handlerKind === "HostCapability",
      requiresApproval: false,
    },
    name: "RuntimeTool",
    loading: "Dynamic",
    permissions: [],
    sources: [],
    execution: {
      Targets: ["Local"],
      Network: "Deny",
      Workspace: "ReadOnly",
    },
    handler,
    runtime: {
      Lifecycle: lifecycle,
      ResultAssessment: "ProcessExit",
    },
    childGrant: "inherit",
    evidenceCapabilities: [],
  };
}
