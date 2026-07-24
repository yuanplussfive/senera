import assert from "node:assert/strict";
import { AgentSystemRuntime } from "../Source/AgentSystem/Runtime/AgentSystemRuntime.js";
import { createIsolatedVerificationRuntimeConfig } from "./VerificationRuntimeConfig.js";

void main();

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const isolatedConfig = await createIsolatedVerificationRuntimeConfig(workspaceRoot);
  const runtime = AgentSystemRuntime.load({
    workspaceRoot,
    configPath: isolatedConfig.configPath,
  });
  try {
    await verifyWorkspaceMcpTools(runtime, workspaceRoot);
    console.log("Workspace MCP tools verification passed.");
  } finally {
    await runtime.close();
    await isolatedConfig.dispose();
  }
}

async function verifyWorkspaceMcpTools(runtime: AgentSystemRuntime, workspaceRoot: string): Promise<void> {
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
    await executeWorkspaceTool(runtime, "WorkspaceReadFile", {
      path: `${workspaceRoot}/package.json`,
      head: 3,
    }),
    '"name": "senera"',
  );

  assertToolText(
    await executeWorkspaceTool(runtime, "WorkspaceListDirectory", {
      path: workspaceRoot,
    }),
    "package.json",
  );

  assertToolText(
    await executeWorkspaceTool(runtime, "WorkspaceSearchFiles", {
      path: workspaceRoot,
      pattern: "**/*AgentToolRunner*",
      excludePatterns: ["node_modules"],
    }),
    "AgentToolRunner",
  );

  assertToolText(
    await executeWorkspaceTool(runtime, "WorkspaceGrep", {
      path: workspaceRoot,
      pattern: "AgentToolRunner",
      maxResults: 3,
    }),
    "AgentToolRunner",
  );

  assertToolText(
    await executeWorkspaceTool(runtime, "WorkspaceListFiles", {
      path: workspaceRoot,
      filePattern: "*.json",
    }),
    "package.json",
  );

  assertToolText(
    await executeWorkspaceTool(runtime, "WorkspaceEditFile", {
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

async function executeWorkspaceTool(
  runtime: AgentSystemRuntime,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await runtime.toolCallExecutor.execute(
    {
      name,
      arguments: args,
    },
    {},
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
