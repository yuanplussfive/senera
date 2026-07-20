import { describe, expect, test } from "vitest";
import { ToolSchema } from "../../../Source/AgentSystem/Schemas/PluginToolManifestSchema.js";
import { PluginManifestSchema } from "../../../Source/AgentSystem/Schemas/PluginManifestSchema.js";

describe("tool execution boundary schema", () => {
  test.each([
    ["Local", "Deny"],
    ["Sandbox", "Deny"],
    ["SandboxPreferred", "Allow"],
  ] as const)("accepts %s with LocalFallback=%s", (boundary, localFallback) => {
    expect(ToolSchema.safeParse(tool(boundary, localFallback)).success).toBe(true);
  });

  test("accepts declarative streaming runtime capabilities", () => {
    const result = ToolSchema.safeParse({
      ...tool("Local", "Deny"),
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
      ...tool("Local", "Deny"),
      Runtime: {
        Lifecycle: "Persistent",
        ProtocolVersion: 1,
      },
    });

    expect(result.success).toBe(false);
  });

  test("requires every host capability to declare private protocol v2", () => {
    const value = tool("Local", "Deny");
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

  test("accepts declarative MCP resource arguments and conditional access intents", () => {
    const result = ToolSchema.safeParse({
      ...mcpTool(),
      Handler: {
        Kind: "McpTool",
        Server: "filesystem",
        Tool: "edit_file",
        Resources: [
          {
            Pointer: "/request/path",
            Intent: {
              Selector: "/dryRun",
              Cases: [{ Equals: true, Intent: "read" }],
              Default: "replace",
            },
          },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  test.each([
    [{ Pointer: "path", Intent: "read" }, "Pointer"],
    [{ Pointer: "/path", Intent: "unknown" }, "Intent"],
    [
      {
        Pointer: "/path",
        Intent: {
          Selector: "/dryRun",
          Cases: [
            { Equals: true, Intent: "read" },
            { Equals: true, Intent: "replace" },
          ],
          Default: "replace",
        },
      },
      "Cases",
    ],
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
    const result = ToolSchema.safeParse({
      ...mcpTool(),
      Runtime: { Lifecycle: "RemoteJob" },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["Runtime", "Capabilities", "Cancellation"],
        }),
      );
    }
  });

  test.each(["Persistent", "RemoteJob"] as const)("requires an explicit v2 protocol for %s runtimes", (lifecycle) => {
    const result = ToolSchema.safeParse({
      ...tool("Local", "Deny"),
      Runtime: {
        Lifecycle: lifecycle,
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["Runtime", "ProtocolVersion"],
        }),
      );
    }
  });

  test.each([
    ["Local", "Allow"],
    ["Sandbox", "Allow"],
    ["SandboxPreferred", "Deny"],
  ] as const)("rejects %s with LocalFallback=%s", (boundary, localFallback) => {
    const result = ToolSchema.safeParse(tool(boundary, localFallback));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["Execution", "LocalFallback"],
        }),
      );
    }
  });

  test.each(["Handler", "Runtime"] as const)("rejects v2 tools without %s", (field) => {
    const value: Record<string, unknown> = { ...tool("Local", "Deny") };
    delete value[field];
    expect(ToolSchema.safeParse(value).success).toBe(false);
  });

  test("rejects plugin manifests without ManifestVersion 2", () => {
    expect(
      PluginManifestSchema.safeParse({
        Plugin: { Name: "LegacyPlugin", Version: "1.0.0", Kind: "Tool" },
      }).success,
    ).toBe(false);
  });
});

function tool(Boundary: "Local" | "Sandbox" | "SandboxPreferred", LocalFallback: "Allow" | "Deny") {
  return {
    Name: "BoundaryTool",
    Handler: { Kind: "HostCapability", Capability: "test" },
    Runtime: { Lifecycle: "Immediate", ProtocolVersion: 2 as const },
    Execution: {
      Boundary,
      Network: "Deny",
      Workspace: "ReadOnly",
      LocalFallback,
    },
  };
}

function mcpTool(protocolVersion?: 2) {
  return {
    Name: "McpBoundaryTool",
    Handler: { Kind: "McpTool", Server: "test", Tool: "test" },
    Runtime: {
      Lifecycle: "OneShot",
      ...(protocolVersion === undefined ? {} : { ProtocolVersion: protocolVersion }),
    },
    Execution: {
      Boundary: "Local",
      Network: "Deny",
      Workspace: "ReadOnly",
      LocalFallback: "Deny",
    },
  };
}
