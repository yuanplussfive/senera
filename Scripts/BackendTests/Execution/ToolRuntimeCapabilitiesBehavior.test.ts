import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  explainUnsupportedAgentToolRuntime,
  resolveAgentToolRuntimeCapabilities,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolRuntimeCapabilities.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/PluginRuntimeTypes.js";

describe("tool runtime capabilities", () => {
  it("accepts persistent v2 host capabilities", () => {
    const tool = runtimeTool("HostCapability", "Persistent", 2);

    expect(explainUnsupportedAgentToolRuntime(tool)).toEqual([]);
    expect(resolveAgentToolRuntimeCapabilities(tool)).toEqual(
      expect.objectContaining({ lifecycle: "persistent", protocolVersion: 2 }),
    );
  });

  it("rejects host capabilities that omit the private v2 protocol declaration", () => {
    const tool = runtimeTool("HostCapability", "Immediate");

    expect(explainUnsupportedAgentToolRuntime(tool)).toEqual([
      "HostCapability requires private tool protocol version 2.",
    ]);
  });

  it("accepts one-shot MCP tools only when they use the native MCP protocol", () => {
    expect(explainUnsupportedAgentToolRuntime(runtimeTool("McpTool", "OneShot"))).toEqual([]);
  });

  it("accepts persistent MCP lifecycle while rejecting private protocol declarations", () => {
    expect(explainUnsupportedAgentToolRuntime(runtimeTool("McpTool", "Persistent"))).toEqual([]);

    const tool = runtimeTool("McpTool", "Persistent", 2);

    expect(explainUnsupportedAgentToolRuntime(tool)).toEqual([
      "McpTool uses its native protocol and must not declare a private tool protocol version.",
    ]);
  });
});

function runtimeTool(
  handlerKind: RegisteredTool["handler"]["kind"],
  lifecycle: NonNullable<RegisteredTool["runtime"]>["Lifecycle"],
  protocolVersion?: 2,
): RegisteredTool {
  const manifestPath = path.resolve("System", "Plugins", "TestRuntime", "PluginManifest.json");
  const handler =
    handlerKind === "HostCapability"
      ? ({ kind: handlerKind, capability: "test" } as const)
      : ({ kind: handlerKind, server: "test", tool: "test", resources: [] } as const);
  return {
    name: "RuntimeTool",
    loading: "Dynamic",
    permissions: [],
    execution: {
      Boundary: "Local",
      Network: "Deny",
      Workspace: "ReadOnly",
      LocalFallback: "Deny",
    },
    handler,
    runtime: {
      Lifecycle: lifecycle,
      ProtocolVersion: protocolVersion,
    },
    evidenceCapabilities: [],
    plugin: {
      rootKind: "System",
      rootPath: path.dirname(manifestPath),
      manifestPath,
      config: {} as never,
      manifest: {
        ManifestVersion: 2,
        Plugin: { Name: "TestRuntime", Version: "1.0.0", Kind: "Tool" },
      },
    },
  };
}
