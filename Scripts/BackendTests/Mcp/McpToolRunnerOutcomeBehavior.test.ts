import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, test } from "vitest";
import type { SeneraExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import {
  AgentMcpToolClient,
  type AgentMcpToolCallOptions,
} from "../../../Source/AgentSystem/Mcp/AgentMcpToolClient.js";
import { AgentMcpToolClientPool } from "../../../Source/AgentSystem/Mcp/AgentMcpToolClientPool.js";
import { AgentMcpToolRunner } from "../../../Source/AgentSystem/Mcp/AgentMcpToolRunner.js";
import { AgentToolExecutionReporter } from "../../../Source/AgentSystem/ToolRuntime/AgentToolExecutionReporter.js";
import type { AgentToolRunnerContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolRunner.js";
import type { RegisteredTool } from "../../../Source/AgentSystem/Types/AgentToolRuntimeTypes.js";
import { AgentExecutionErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";

describe("MCP tool runner outcome", () => {
  test("uses standard MCP isError as the execution-failure boundary", async () => {
    const result = await runMcpTool(async () => ({
      isError: true,
      content: [{ type: "text", text: "upstream rejected the request" }],
    }));

    expect(result.response).toMatchObject({
      ok: false,
      error: {
        code: AgentExecutionErrorCodes.ToolExecutionError,
        message: "upstream rejected the request",
        details: { mcpIsError: true },
      },
    });
  });

  test("keeps a successful MCP business payload containing error data successful", async () => {
    const result = await runMcpTool(async () => ({
      structuredContent: { error: { message: "domain-level result" } },
    }));

    expect(result.response).toEqual(
      expect.objectContaining({
        ok: true,
        result: { error: { message: "domain-level result" } },
      }),
    );
  });

  test("preserves MCP request timeout as a typed timeout", async () => {
    const result = await runMcpTool(async () => {
      throw new McpError(ErrorCode.RequestTimeout, "request timed out");
    });

    expect(result.response).toMatchObject({
      ok: false,
      error: {
        code: AgentExecutionErrorCodes.ToolProcessTimeout,
        details: { mcpErrorCode: ErrorCode.RequestTimeout },
      },
    });
  });

  test("uses the host abort signal as the authoritative cancellation source", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled by user"));
    const result = await runMcpTool(async () => {
      throw new Error("transport closed");
    }, controller.signal);

    expect(result.response).toMatchObject({
      ok: false,
      error: { code: AgentExecutionErrorCodes.ToolProcessCancelled },
    });
  });
});

async function runMcpTool(callTool: (options: AgentMcpToolCallOptions) => Promise<unknown>, signal?: AbortSignal) {
  const client = {
    closed: false,
    callTool: async (_toolName: string, _args: Record<string, unknown>, options: AgentMcpToolCallOptions) =>
      callTool(options),
    close: async () => undefined,
  } as AgentMcpToolClient;
  const pool = new AgentMcpToolClientPool(async () => client);
  const runner = new AgentMcpToolRunner({
    config: { ModelProviders: [] },
    executionEnv: {} as SeneraExecutionEnv,
    clientPool: pool,
  });
  const tool = registeredMcpTool();
  try {
    return await runner.run(
      tool,
      {},
      executionContext(signal),
      new AgentToolExecutionReporter({ toolName: tool.name }),
    );
  } finally {
    await pool.close();
  }
}

function registeredMcpTool(): RegisteredTool {
  return {
    owner: {
      kind: "mcp",
      name: "outcome-server",
      title: "Outcome server",
      rootPath: process.cwd(),
      revision: "test",
      trusted: false,
      requiresApproval: false,
    },
    name: "mcp__outcome__probe",
    loading: "Dynamic",
    permissions: [],
    handler: {
      kind: "McpTool",
      server: {
        id: "outcome-server",
        revision: "test",
        transport: "http",
        url: "https://example.invalid/mcp",
      },
      tool: "probe",
      readOnly: false,
    },
    execution: { Targets: ["Local"], Network: "Allow", Workspace: "ReadOnly" },
    runtime: { Lifecycle: "Persistent", ProtocolVersion: 2, ResultAssessment: "ProcessExit" },
    sources: [],
    evidenceCapabilities: [],
  };
}

function executionContext(signal?: AbortSignal): AgentToolRunnerContext {
  return {
    signal,
    executionPlan: {
      target: "Local",
      backend: "local",
      network: "default",
      workspaceMount: "readonly",
      availableTargets: ["Local"],
    },
  };
}
