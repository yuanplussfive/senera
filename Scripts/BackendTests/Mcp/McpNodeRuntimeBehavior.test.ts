import { describe, expect, test } from "vitest";
import {
  createAgentMcpNodeRuntimeLaunch,
  createAgentMcpStdioRuntimeLaunch,
} from "../../../Source/AgentSystem/Mcp/AgentMcpNodeRuntime.js";
import {
  AgentMcpServerRuntimes,
  type AgentMcpStdioRuntimeEndpoint,
} from "../../../Source/AgentSystem/McpPackages/AgentMcpPackageTypes.js";

describe("MCP declared Node runtime", () => {
  test("uses the embedded Electron executable and enables Node mode for local launches", () => {
    expect(
      createAgentMcpNodeRuntimeLaunch(
        { args: ["server.mjs"], env: { MCP_SETTING: "value" } },
        { executable: "Senera.exe", isElectron: true },
      ),
    ).toEqual({
      command: "Senera.exe",
      args: ["server.mjs"],
      env: { MCP_SETTING: "value", ELECTRON_RUN_AS_NODE: "1" },
    });
  });

  test("keeps the portable command for non-local launches", () => {
    const server = nodeServer();

    expect(createAgentMcpStdioRuntimeLaunch(server, "sandbox")).toEqual({
      command: "node",
      args: ["server.mjs"],
      env: { MCP_SETTING: "value" },
    });
  });

  test("resolves a declared Node server to the current local runtime", () => {
    const launch = createAgentMcpStdioRuntimeLaunch(nodeServer(), "local");

    expect(launch).toMatchObject({
      command: process.execPath,
      args: ["server.mjs"],
      env: { MCP_SETTING: "value" },
    });
  });
});

function nodeServer(): AgentMcpStdioRuntimeEndpoint {
  return {
    id: "test-server",
    packageName: "test-package",
    packageRoot: "C:/senera/McpServers/test-package",
    revision: "test",
    transport: "stdio",
    runtime: AgentMcpServerRuntimes.Node,
    command: "node",
    args: ["server.mjs"],
    cwd: "C:/senera/McpServers/test-package",
    env: { MCP_SETTING: "value" },
  };
}
