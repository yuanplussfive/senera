import { resolveToolExecutionConfig } from "../AgentDefaults.js";
import path from "node:path";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "../Xml/AgentXmlStatus.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import {
  toolProcessFailureResult,
  toolProcessSuccessResult,
} from "../ToolRuntime/AgentToolProcessEnvelope.js";
import type { AgentToolRunnerContext } from "../ToolRuntime/AgentToolRunner.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { buildAgentMcpExecutionProfile } from "./AgentMcpExecutionProfile.js";
import { resolveMcpServerManifest } from "./AgentMcpManifestResolver.js";
import { withAgentMcpToolClient } from "./AgentMcpToolClient.js";

export interface AgentMcpToolRunnerOptions {
  config: AgentSystemConfig;
  workspaceRoot: string;
  executionEnv: SeneraExecutionEnv;
}

export class AgentMcpToolRunner {
  constructor(private readonly options: AgentMcpToolRunnerOptions) {}

  async run(
    tool: RegisteredTool,
    args: Record<string, unknown>,
    context: AgentToolRunnerContext = {},
  ): Promise<AgentToolProcessRunResult> {
    if (tool.handler.kind !== "McpTool") {
      return mcpToolFailure(`工具不是 MCP 工具：${tool.name}`, {
        toolName: tool.name,
      });
    }

    const handler = tool.handler;
    const server = tool.plugin.manifest.McpServers?.find((item) => item.Id === handler.server);
    if (!server) {
      return mcpToolFailure(`MCP server 没有声明：${handler.server}`, {
        toolName: tool.name,
        serverId: handler.server,
      });
    }

    try {
      const toolExecution = resolveToolExecutionConfig(this.options.config);
      const resolvedServer = resolveMcpServerManifest(server, {
        workspaceRoot: this.options.workspaceRoot,
        pluginRoot: tool.plugin.rootPath,
      });
      const executionProfile = buildAgentMcpExecutionProfile(tool);
      const result = await withAgentMcpToolClient({
        server: resolvedServer,
        requestTimeoutMs: toolExecution.TimeoutMs,
        spawnPersistentProcess: this.options.executionEnv.spawnPersistentProcess,
        executionProfile,
        signal: context.signal,
      }, (client) => client.callTool(handler.tool, normalizeMcpToolArguments(args, {
        workspaceRoot: this.options.workspaceRoot,
        serverId: handler.server,
      })));

      return toolProcessSuccessResult(projectMcpToolResult(result));
    } catch (error) {
      return mcpToolFailure(error instanceof Error ? error.message : String(error), {
        toolName: tool.name,
        serverId: handler.server,
        mcpToolName: handler.tool,
      });
    }
  }
}

function normalizeMcpToolArguments(
  args: Record<string, unknown>,
  context: { workspaceRoot: string; serverId: string },
): Record<string, unknown> {
  const normalizers: Record<string, () => Record<string, unknown>> = {
    ripgrep: () => normalizeWorkspacePathArgument(args, context.workspaceRoot),
  };

  return normalizers[context.serverId]?.() ?? args;
}

function normalizeWorkspacePathArgument(
  args: Record<string, unknown>,
  workspaceRoot: string,
): Record<string, unknown> {
  const rawPath = typeof args.path === "string" ? args.path : undefined;
  if (!rawPath) {
    return args;
  }

  const absolute = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(workspaceRoot, rawPath);
  const relative = path.relative(workspaceRoot, absolute);
  const normalizedPath = relative.length === 0
    ? "."
    : relative.split(path.sep).join("/");

  return path.isAbsolute(rawPath)
    ? { ...args, path: normalizedPath }
    : args;
}

function projectMcpToolResult(result: unknown): unknown {
  return {
    mcp: result,
    text: extractMcpText(result),
  };
}

function extractMcpText(value: unknown): string {
  const record = readRecord(value);
  const structured = readRecord(record.structuredContent);
  if (typeof structured.content === "string") {
    return structured.content;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  return content
    .map((item) => readRecord(item).text)
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mcpToolFailure(
  message: string,
  details: Record<string, unknown>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult({
    code: AgentExecutionErrorCodes.PluginExecutionError,
    message,
    details: {
      phase: AgentToolProcessErrorPhases.RuntimeExecution,
      ...details,
    },
  });
}
