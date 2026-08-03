import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, test } from "vitest";

describe("bundled standard MCP servers", () => {
  test.each([
    ["weather", "forecast"],
    ["web-research", "search"],
  ])("%s exposes %s through tools/list", async (packageName, toolName) => {
    const client = new Client({ name: "senera-mcp-package-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["./mcp/server.mjs"],
        cwd: path.resolve("McpServers", packageName),
      }),
    );
    try {
      const listed = await client.listTools();
      expect(listed.tools).toContainEqual(expect.objectContaining({ name: toolName }));
      const tool = listed.tools.find((candidate) => candidate.name === toolName);
      expect(tool?.inputSchema.properties).not.toHaveProperty("timeoutMs");
    } finally {
      await client.close();
    }
  });
});
