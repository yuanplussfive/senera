import { describe, expect, test } from "vitest";
import {
  AgentToolExecutionTargetArgument,
  AgentToolExecutionPlanError,
  AgentToolExecutionTargetError,
  projectAgentToolInvocationSchema,
  bindAgentToolInvocationToExecutionPlan,
  resolveAgentToolInvocation,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolExecutionPlan.js";
import { PluginManifestSchema } from "../../../Source/AgentSystem/Schemas/PluginManifestSchema.js";
import { ToolSchema } from "../../../Source/AgentSystem/Schemas/PluginToolManifestSchema.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/PluginRuntimeTypes.js";

describe("tool execution manifest schema", () => {
  const targetCases: Array<[Array<"Sandbox" | "Local">]> = [[["Local"]], [["Sandbox"]], [["Sandbox", "Local"]]];

  test.each(targetCases)("accepts Targets=%o", (targets) => {
    expect(ToolSchema.safeParse(tool(targets)).success).toBe(true);
  });

  test("requires at least one execution target", () => {
    const result = ToolSchema.safeParse(tool([]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["Execution", "Targets"] }));
    }
  });

  test("rejects duplicate execution targets", () => {
    const result = ToolSchema.safeParse(tool(["Local", "Local"]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["Execution", "Targets", 1], message: expect.stringContaining("once") }),
      );
    }
  });

  test("accepts declarative streaming runtime capabilities", () => {
    const result = ToolSchema.safeParse({
      ...tool(["Local"]),
      Runtime: {
        Lifecycle: "Persistent",
        ProtocolVersion: 2,
        Capabilities: {
          Progress: true,
          OutputStreaming: true,
          InteractiveInput: true,
          Cancellation: true,
          ResumableEvents: true,
        },
      },
    });

    expect(result.success).toBe(true);
  });

  test("rejects removed private protocol versions", () => {
    const result = ToolSchema.safeParse({
      ...tool(["Local"]),
      Runtime: {
        Lifecycle: "Persistent",
        ProtocolVersion: 1,
      },
    });

    expect(result.success).toBe(false);
  });

  test("requires every host capability to declare private protocol v2", () => {
    const value = tool(["Local"]);
    delete (value.Runtime as Partial<typeof value.Runtime>).ProtocolVersion;
    const result = ToolSchema.safeParse(value);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["Runtime", "ProtocolVersion"],
          message: "HostCapability requires private tool protocol version 2.",
        }),
      );
    }
  });

  test("keeps MCP on its native protocol without a private protocol declaration", () => {
    expect(ToolSchema.safeParse(mcpTool()).success).toBe(true);
    const result = ToolSchema.safeParse(mcpTool(2));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["Runtime", "ProtocolVersion"],
          message: "McpTool uses its native protocol and must not declare a private tool protocol version.",
        }),
      );
    }
  });

  test("accepts capability-declared MCP resource arguments", () => {
    const result = ToolSchema.safeParse({
      ...mcpTool(),
      Handler: {
        Kind: "McpTool",
        Server: "filesystem",
        Tool: "edit_file",
        Resources: [
          {
            Capability: "senera.workspace.path",
            Pointer: "/request/path",
            Parameters: {
              Intent: {
                Selector: "/dryRun",
                Cases: [{ Equals: true, Intent: "read" }],
                Default: "replace",
              },
            },
          },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  test.each([
    [{ Capability: "senera.workspace.path", Pointer: "path" }, "Pointer"],
    [{ Capability: "", Pointer: "/path" }, "Capability"],
    [{ Capability: "senera.upload.read", Pointer: "/path", Binding: "not a binding" }, "Binding"],
  ] as const)("rejects invalid MCP resource declaration %#", (resource, issueField) => {
    const result = ToolSchema.safeParse({
      ...mcpTool(),
      Handler: { Kind: "McpTool", Server: "test", Tool: "test", Resources: [resource] },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes(issueField))).toBe(true);
    }
  });

  test.each(["Persistent", "RemoteJob"] as const)("supports native MCP %s lifecycle", (lifecycle) => {
    expect(
      ToolSchema.safeParse({
        ...mcpTool(),
        Runtime: {
          Lifecycle: lifecycle,
          Capabilities: lifecycle === "RemoteJob" ? { Cancellation: true } : undefined,
        },
      }).success,
    ).toBe(true);
  });

  test("accepts MCP form elicitation for persistent tools", () => {
    expect(
      ToolSchema.safeParse({
        ...mcpTool(),
        Runtime: { Lifecycle: "Persistent", Capabilities: { InteractiveInput: true } },
      }).success,
    ).toBe(true);
  });

  test("accepts resumable events for MCP RemoteJob streaming", () => {
    const result = ToolSchema.safeParse({
      ...mcpTool(),
      Runtime: {
        Lifecycle: "RemoteJob",
        Capabilities: {
          Cancellation: true,
          Progress: true,
          OutputStreaming: true,
          ResumableEvents: true,
        },
      },
    });

    expect(result.success).toBe(true);
  });

  test.each([
    ["Persistent", { Progress: true, ResumableEvents: true }],
    ["RemoteJob", { Cancellation: true, ResumableEvents: true }],
  ] as const)("rejects resumable MCP events without its full runtime contract (%s)", (lifecycle, capabilities) => {
    const result = ToolSchema.safeParse({
      ...mcpTool(),
      Runtime: { Lifecycle: lifecycle, Capabilities: capabilities },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["Runtime", "Capabilities", "ResumableEvents"],
          message: expect.stringContaining("RemoteJob"),
        }),
      );
    }
  });

  test("requires cancellation for RemoteJob", () => {
    const result = ToolSchema.safeParse({ ...mcpTool(), Runtime: { Lifecycle: "RemoteJob" } });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["Runtime", "Capabilities", "Cancellation"] }),
      );
    }
  });

  test.each(["Persistent", "RemoteJob"] as const)(
    "requires an explicit v2 protocol for %s host runtimes",
    (lifecycle) => {
      const result = ToolSchema.safeParse({ ...tool(["Local"]), Runtime: { Lifecycle: lifecycle } });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["Runtime", "ProtocolVersion"] }));
      }
    },
  );

  test.each(["Handler", "Runtime"] as const)("rejects v2 tools without %s", (field) => {
    const value: Record<string, unknown> = { ...tool(["Local"]) };
    delete value[field];
    expect(ToolSchema.safeParse(value).success).toBe(false);
  });

  test("rejects plugin manifests without ManifestVersion 2", () => {
    expect(
      PluginManifestSchema.safeParse({ Plugin: { Name: "LegacyPlugin", Version: "1.0.0", Kind: "Tool" } }).success,
    ).toBe(false);
  });
});

describe("tool execution plan", () => {
  test("uses a tool's only target and does not expose a selector", () => {
    const invocation = resolveAgentToolInvocation(registeredTool(["Sandbox"]), { command: "pwd" });

    expect(invocation).toEqual({
      arguments: { command: "pwd" },
      executionPlan: expect.objectContaining({ target: "Sandbox", backend: "sandbox" }),
    });
    expect(projectAgentToolInvocationSchema(registeredTool(["Sandbox"]), objectSchema()).properties).not.toHaveProperty(
      AgentToolExecutionTargetArgument,
    );
  });

  test("requires a declared target for multi-target tools and removes it before invocation", () => {
    const tool_ = registeredTool(["Sandbox", "Local"]);

    expect(() => resolveAgentToolInvocation(tool_, { command: "pwd" })).toThrow(
      expect.objectContaining({ name: "AgentToolExecutionTargetError", kind: "missing" }),
    );

    const invocation = resolveAgentToolInvocation(tool_, { command: "pwd", executionTarget: "Local" });
    expect(invocation.arguments).toEqual({ command: "pwd" });
    expect(invocation.executionPlan).toEqual(
      expect.objectContaining({ target: "Local", backend: "local", availableTargets: ["Sandbox", "Local"] }),
    );
    const schema = projectAgentToolInvocationSchema(tool_, objectSchema());
    expect(schema.properties).toMatchObject({
      executionTarget: { type: "string", enum: ["Sandbox", "Local"] },
    });
    expect(schema.required).toEqual(["command", "executionTarget"]);
  });

  test("rejects an undeclared target for all tools", () => {
    expect(() => resolveAgentToolInvocation(registeredTool(["Local"]), { executionTarget: "Sandbox" })).toThrow(
      AgentToolExecutionTargetError,
    );
  });

  test("verifies an inherited execution plan and keeps its selector out of plugin arguments", () => {
    const tool_ = registeredTool(["Sandbox", "Local"]);
    const invocation = bindAgentToolInvocationToExecutionPlan(
      tool_,
      { command: "pwd", executionTarget: "Sandbox" },
      {
        target: "Sandbox",
        backend: "sandbox",
        network: "disabled",
        workspaceMount: "readonly",
        availableTargets: ["Sandbox", "Local"],
      },
    );
    expect(invocation.arguments).toEqual({ command: "pwd" });

    expect(() =>
      bindAgentToolInvocationToExecutionPlan(
        tool_,
        { command: "pwd" },
        {
          ...invocation.executionPlan,
          backend: "local",
        },
      ),
    ).toThrow(AgentToolExecutionPlanError);
  });
});

function tool(Targets: Array<"Sandbox" | "Local">) {
  return {
    Name: "BoundaryTool",
    Handler: { Kind: "HostCapability", Capability: "test" },
    Runtime: { Lifecycle: "Immediate", ProtocolVersion: 2 as const },
    Execution: { Targets, Network: "Deny", Workspace: "ReadOnly" },
  };
}

function mcpTool(protocolVersion?: 2) {
  return {
    Name: "McpBoundaryTool",
    Handler: { Kind: "McpTool", Server: "test", Tool: "test" },
    Runtime: { Lifecycle: "OneShot", ...(protocolVersion === undefined ? {} : { ProtocolVersion: protocolVersion }) },
    Execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
  };
}

function registeredTool(Targets: Array<"Sandbox" | "Local">): RegisteredTool {
  return {
    plugin: {} as RegisteredTool["plugin"],
    name: "BoundaryTool",
    loading: "Dynamic",
    permissions: [],
    sources: [],
    execution: { Targets, Network: "Deny", Workspace: "ReadOnly" },
    handler: { kind: "HostCapability", capability: "test" },
    runtime: { Lifecycle: "Immediate", ProtocolVersion: 2 },
    evidenceCapabilities: [],
  };
}

function objectSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  };
}
