import assert from "node:assert/strict";
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { verificationConfigPath } from "./VerificationConfig.js";

const workspaceRoot = process.cwd();
const runtime = AgentSystemRuntime.load({
  workspaceRoot,
  configPath: verificationConfigPath(workspaceRoot),
});

try {
  await verifyWorkspaceMcpTools();
  console.log("Workspace MCP tools verification passed.");
} finally {
  runtime.toolSearch.close();
}

async function verifyWorkspaceMcpTools(): Promise<void> {
  const workspaceTools = runtime.registry.listTools().filter((tool) => tool.name.startsWith("Workspace"));

  assert.deepEqual(
    workspaceTools.map((tool) => [tool.name, tool.handler.kind]),
    [
      ["WorkspaceReadFile", "McpTool"],
      ["WorkspaceListDirectory", "McpTool"],
      ["WorkspaceSearchFiles", "McpTool"],
      ["WorkspaceGrep", "McpTool"],
      ["WorkspaceListFiles", "McpTool"],
      ["WorkspaceEditFile", "McpTool"],
      ["WorkspaceWriteFile", "McpTool"],
      ["WorkspaceCreateDirectory", "McpTool"],
      ["WorkspaceMoveFile", "McpTool"],
      ["WorkspaceApplyPatch", "HostCapability"],
    ],
  );

  assertToolText(
    await executeWorkspaceTool("WorkspaceReadFile", {
      path: `${workspaceRoot}/package.json`,
      head: 3,
    }),
    '"name": "senera"',
  );

  assertToolText(
    await executeWorkspaceTool("WorkspaceListDirectory", {
      path: workspaceRoot,
    }),
    "package.json",
  );

  assertToolText(
    await executeWorkspaceTool("WorkspaceSearchFiles", {
      path: workspaceRoot,
      pattern: "**/*AgentToolRunner*",
      excludePatterns: ["node_modules"],
    }),
    "AgentToolRunner",
  );

  assertToolText(
    await executeWorkspaceTool("WorkspaceGrep", {
      path: workspaceRoot,
      pattern: "AgentToolRunner",
      maxResults: 3,
    }),
    "AgentToolRunner",
  );

  assertToolText(
    await executeWorkspaceTool("WorkspaceListFiles", {
      path: workspaceRoot,
      filePattern: "*.json",
    }),
    "package.json",
  );

  assertToolText(
    await executeWorkspaceTool("WorkspaceEditFile", {
      path: `${workspaceRoot}/package.json`,
      edits: [
        {
          oldText: '"name": "senera"',
          newText: '"name": "senera"',
        },
      ],
      dryRun: true,
    }),
    "package.json",
  );
}

async function executeWorkspaceTool(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await runtime.toolCallExecutor.execute(
    {
      name,
      arguments: args,
    },
    {
      loadedToolNames: "all",
    },
  );

  assert.equal(result.kind, "ToolResults");
  const [toolResult] = result.value;
  assert.ok(toolResult, `${name} should return a tool result.`);
  const text = readToolResultText(toolResult.result);
  assert.ok(text.length > 0, `${name} should return text.`);
  return text;
}

function readToolResultText(value: unknown): string {
  const record = readRecord(value);
  return typeof record.text === "string" ? record.text : "";
}

function assertToolText(actual: string, expectedFragment: string): void {
  assert.ok(
    actual.includes(expectedFragment),
    `Expected tool text to include ${expectedFragment}, got: ${actual.slice(0, 400)}`,
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
