import { describe, expect, test, vi } from "vitest";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { AgentMcpStdioConnectionClosedError } from "../../../Source/AgentSystem/Mcp/AgentMcpStdioTransport.js";
import { AgentMcpToolClient } from "../../../Source/AgentSystem/Mcp/AgentMcpToolClient.js";
import type { AgentMcpToolClientOptions } from "../../../Source/AgentSystem/Mcp/AgentMcpToolClient.js";

describe("MCP tool client connection diagnostics", () => {
  test("preserves the transport exit diagnostic instead of exposing the SDK connection-closed error", async () => {
    const diagnostic = new AgentMcpStdioConnectionClosedError(
      "Senera.exe",
      42,
      23,
      null,
      "fatal: invalid server configuration\n",
    );
    const rawClient = {
      setNotificationHandler: vi.fn(),
      callTool: vi.fn(async () => {
        throw new McpError(ErrorCode.ConnectionClosed, "Connection closed");
      }),
    };
    const client = new AgentMcpToolClient(rawClient as never, options(), undefined, () => diagnostic);

    await expect(client.callTool("workspace.search", {})).rejects.toBe(diagnostic);
  });
});

function options(): AgentMcpToolClientOptions {
  return {
    server: {
      id: "fixture",
      command: "node",
      args: ["server.js"],
      cwd: "C:/workspace",
    },
    requestTimeoutMs: 1_000,
    spawnPersistentProcess: async () => {
      throw new Error("unused");
    },
    executionProfile: {
      name: "fixture",
      kind: "mcp-server",
      backend: "local",
      localFallback: "deny",
    },
    terminationGraceMs: 10,
  };
}
