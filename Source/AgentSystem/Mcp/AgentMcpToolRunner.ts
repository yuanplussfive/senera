import { resolveToolExecutionConfig } from "../AgentDefaults.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import type { AgentToolRunnerContext } from "../ToolRuntime/AgentToolRunner.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { buildAgentMcpExecutionProfile } from "./AgentMcpExecutionProfile.js";
import { resolveMcpServerManifest } from "./AgentMcpManifestResolver.js";
import { withAgentMcpToolClient } from "./AgentMcpToolClient.js";
import { bindAgentToolFallbackContext } from "../ToolRuntime/AgentToolFallbackContext.js";
import { AgentMcpToolClientPool } from "./AgentMcpToolClientPool.js";
import type { AgentMcpToolCallOptions, AgentMcpToolClient, AgentMcpToolProgress } from "./AgentMcpToolClient.js";
import { AgentToolExecutionReporter } from "../ToolRuntime/AgentToolExecutionReporter.js";
import { resolveAgentToolRuntimeCapabilities } from "../ToolRuntime/AgentToolRuntimeCapabilities.js";
import { projectAgentMcpPluginRuntimeEnvironment } from "./AgentMcpPluginRuntimeEnvironment.js";
import { projectAgentMcpResourceArguments } from "./AgentMcpResourceArgumentProjector.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import type { AgentInteractionInputOwner } from "../Interaction/AgentInteractionInputTypes.js";

export interface AgentMcpToolRunnerOptions {
  config: AgentSystemConfig;
  workspaceRoot: string;
  executionEnv: SeneraExecutionEnv;
  interactionInput?: AgentInteractionInputRuntime;
}

export class AgentMcpToolRunner {
  private readonly clients = new AgentMcpToolClientPool();

  constructor(private readonly options: AgentMcpToolRunnerOptions) {}

  async run(
    tool: RegisteredTool,
    args: Record<string, unknown>,
    context: AgentToolRunnerContext,
    reporter: AgentToolExecutionReporter,
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
      const resolvedServer = projectAgentMcpPluginRuntimeEnvironment(
        resolveMcpServerManifest(server, {
          workspaceRoot: this.options.workspaceRoot,
          pluginRoot: tool.plugin.rootPath,
        }),
        tool.plugin.manifest,
        handler.server,
      );
      const executionProfile = bindAgentToolFallbackContext({
        profile: buildAgentMcpExecutionProfile(tool),
        tool,
        correlation: context,
      });
      const runtime = resolveAgentToolRuntimeCapabilities(tool);
      if (runtime.interactiveInput && !this.options.interactionInput) {
        throw new Error(`Interactive MCP tool ${tool.name} requires the host interaction-input runtime.`);
      }
      const normalizedArgs = await projectAgentMcpResourceArguments(args, handler.resources, this.options.executionEnv);
      const connection = {
        server: resolvedServer,
        requestTimeoutMs: toolExecution.TimeoutMs,
        spawnPersistentProcess: this.options.executionEnv.spawnPersistentProcess,
        executionProfile,
        terminationGraceMs: toolExecution.Resources.TerminationGraceMs,
        maxFrameBytes: Math.max(toolExecution.MaxStdoutBytes, toolExecution.MaxStderrBytes),
        maxStderrBytes: toolExecution.MaxStderrBytes,
        interactionInput: runtime.interactiveInput ? this.options.interactionInput : undefined,
      };
      const callOptions: AgentMcpToolCallOptions = {
        signal: context.signal,
        correlation: {
          sessionId: context.sessionId,
          requestId: context.requestId,
          step: context.step,
          toolCallId: context.toolCallId,
          batchId: context.batchId,
        },
        onProgress: runtime.progress ? (progress) => reportMcpProgress(reporter, progress) : undefined,
        onOutput: (output) =>
          reporter.outputText({
            stream: output.stream,
            text: output.text,
            byteLength: output.byteLength,
          }),
        task: runtime.lifecycle === "remote-job",
        resumableEvents: runtime.resumableEvents,
        taskEventCursor: runtime.resumableEvents ? { value: 0 } : undefined,
        interactionOwner: runtime.interactiveInput ? projectInteractionOwner(tool, context) : undefined,
        interactionEventSink: runtime.interactiveInput ? context.onEvent : undefined,
        onTask:
          runtime.lifecycle === "remote-job"
            ? (task) =>
                reporter.progress({
                  message: task.statusMessage ?? `MCP task ${task.status}`,
                  taskId: task.taskId,
                  state: task.status,
                  terminal: task.terminal,
                  pollIntervalMs: task.pollInterval,
                })
            : undefined,
      };
      const callTool = (client: AgentMcpToolClient) => client.callTool(handler.tool, normalizedArgs, callOptions);
      const callPooledTool = (): Promise<unknown> =>
        runtime.lifecycle === "remote-job"
          ? this.clients.withRecoverableTask(connection, callTool, callOptions, (error) => {
              reporter.progress({
                message: "Reattaching to MCP task after connection loss.",
                taskId: error.taskId,
                state: "reattaching",
                terminal: false,
              });
            })
          : this.clients.withClient(connection, callTool);
      const result: unknown =
        runtime.lifecycle === "persistent" || runtime.lifecycle === "remote-job"
          ? await callPooledTool()
          : await withAgentMcpToolClient({ ...connection, signal: context.signal }, callTool);

      if (readRecord(result).isError === true) {
        throw new Error(extractMcpText(result) || `MCP tool ${handler.tool} failed.`);
      }
      return toolProcessSuccessResult(projectMcpToolResult(result));
    } catch (error) {
      return mcpToolFailure(error instanceof Error ? error.message : String(error), {
        toolName: tool.name,
        serverId: handler.server,
        mcpToolName: handler.tool,
      });
    }
  }

  close(): Promise<void> {
    return this.clients.close();
  }
}

function projectInteractionOwner(tool: RegisteredTool, context: AgentToolRunnerContext): AgentInteractionInputOwner {
  const required = {
    sessionId: context.sessionId,
    requestId: context.requestId,
    step: context.step,
    toolCallId: context.toolCallId,
  };
  const missing = Object.entries(required).flatMap(([field, value]) => (value === undefined ? [field] : []));
  if (missing.length > 0) {
    throw new Error(`Interactive MCP tool ${tool.name} is missing correlation fields: ${missing.join(", ")}.`);
  }
  if (!context.sessionId || !context.requestId || context.step === undefined || !context.toolCallId) {
    throw new Error(`Interactive MCP tool ${tool.name} has invalid correlation context.`);
  }
  return {
    sessionId: context.sessionId,
    requestId: context.requestId,
    step: context.step,
    toolCallId: context.toolCallId,
    batchId: context.batchId,
    toolName: tool.name,
  };
}

function reportMcpProgress(reporter: AgentToolExecutionReporter, progress: AgentMcpToolProgress): void {
  reporter.progress({
    completed: progress.progress,
    total: progress.total,
    message: progress.message,
  });
}

function projectMcpToolResult(result: unknown): unknown {
  const record = readRecord(result);
  const structured = readRecord(record.structuredContent);
  const text = extractMcpText(record);
  const protocolFields = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "structuredContent"));
  if (Object.keys(structured).length > 0) {
    return {
      ...protocolFields,
      ...structured,
      text: typeof structured.text === "string" ? structured.text : text,
    };
  }
  return {
    ...protocolFields,
    text,
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
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function mcpToolFailure(message: string, details: Record<string, unknown>): AgentToolProcessRunResult {
  return toolProcessFailureResult({
    code: AgentExecutionErrorCodes.PluginExecutionError,
    message,
    details: {
      phase: AgentToolProcessErrorPhases.RuntimeExecution,
      ...details,
    },
  });
}
