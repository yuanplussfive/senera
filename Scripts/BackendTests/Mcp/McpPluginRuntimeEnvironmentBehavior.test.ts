import { describe, expect, test } from "vitest";
import { ToolPluginEnvironmentVariables } from "@senera/tool-plugin-sdk/protocol";
import { projectAgentMcpPluginRuntimeEnvironment } from "../../../Source/AgentSystem/Mcp/AgentMcpPluginRuntimeEnvironment.js";
import type { PluginManifest } from "../../../Source/AgentSystem/Types/PluginManifestTypes.js";

describe("MCP plugin runtime environment", () => {
  test("projects the sorted unique RemoteJob tools for one server", () => {
    const server = {
      id: "tools",
      command: "node",
      args: ["server.js"],
      cwd: "C:/workspace",
      env: { EXISTING: "value" },
    };

    const projected = projectAgentMcpPluginRuntimeEnvironment(
      server,
      manifest([
        tool("RemoteB", "tools", "remote.b", "RemoteJob"),
        tool("Immediate", "tools", "immediate", "OneShot"),
        tool("OtherServer", "other", "remote.other", "RemoteJob"),
        tool("RemoteA", "tools", "remote.a", "RemoteJob"),
        tool("RemoteADuplicate", "tools", "remote.a", "RemoteJob"),
      ]),
      "tools",
    );

    expect(projected).toEqual({
      ...server,
      env: {
        EXISTING: "value",
        [ToolPluginEnvironmentVariables.RemoteJobTools]: JSON.stringify(["remote.a", "remote.b"]),
      },
    });
  });

  test("preserves the server identity when it has no RemoteJob tools", () => {
    const server = { id: "tools", command: "node", args: [], cwd: "C:/workspace" };
    const projected = projectAgentMcpPluginRuntimeEnvironment(
      server,
      manifest([tool("Immediate", "tools", "immediate", "Persistent")]),
      "tools",
    );

    expect(projected).toBe(server);
  });
});

function manifest(tools: NonNullable<PluginManifest["Tools"]>): PluginManifest {
  return {
    ManifestVersion: 2,
    Plugin: { Name: "McpRuntimeFixture", Version: "1.0.0", Kind: "Tool" },
    Tools: tools,
  };
}

function tool(
  name: string,
  server: string,
  protocolTool: string,
  lifecycle: "OneShot" | "Persistent" | "RemoteJob",
): NonNullable<PluginManifest["Tools"]>[number] {
  return {
    Name: name,
    Handler: { Kind: "McpTool", Server: server, Tool: protocolTool },
    Execution: {
      Targets: ["Local"],
      Network: "Deny",
      Workspace: "ReadOnly",
    },
    Runtime: { Lifecycle: lifecycle },
  };
}
