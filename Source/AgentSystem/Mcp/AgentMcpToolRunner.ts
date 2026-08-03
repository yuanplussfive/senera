import { resolveToolExecutionConfig } from "../AgentDefaults.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessTypes.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import type { AgentToolRunnerContext } from "../ToolRuntime/AgentToolRunner.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { createAgentMcpExecutionProfile } from "./AgentMcpExecutionProfile.js";
import { withAgentMcpToolClient } from "./AgentMcpToolClient.js";
import { AgentMcpToolClientPool } from "./AgentMcpToolClientPool.js";
import type { AgentMcpToolCallOptions, AgentMcpToolClient, AgentMcpToolProgress } from "./AgentMcpToolClient.js";
import type { AgentMcpToolsChangedHandler } from "./AgentMcpToolCatalogChange.js";
import { AgentToolExecutionReporter } from "../ToolRuntime/AgentToolExecutionReporter.js";
import { resolveAgentToolRuntimeCapabilities } from "../ToolRuntime/AgentToolRuntimeCapabilities.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import type { AgentInteractionInputOwner } from "../Interaction/AgentInteractionInputTypes.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { agentUnknownRecordOrEmpty, isAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { createAgentMcpSamplingHandler, type AgentMcpSamplingHandler } from "./AgentMcpSamplingRuntime.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

export interface AgentMcpToolRunnerOptions {
  config: AgentSystemConfig;
  executionEnv: SeneraExecutionEnv;
  interactionInput?: AgentInteractionInputRuntime;
  modelProviderId?: string;
  onToolsChanged?: AgentMcpToolsChangedHandler;
  clientPool?: AgentMcpToolClientPool;
  sampling?: AgentMcpSamplingHandler;
}

export class AgentMcpToolRunner {
  private readonly clients: AgentMcpToolClientPool;
  private readonly ownsClientPool: boolean;
  private readonly sampling: AgentMcpSamplingHandler;

  constructor(private readonly options: AgentMcpToolRunnerOptions) {
    this.clients = options.clientPool ?? new AgentMcpToolClientPool();
    this.ownsClientPool = !options.clientPool;
    this.sampling = options.sampling ?? createAgentMcpSamplingHandler(options.config, options.modelProviderId);
  }

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
    const toolExecution = resolveToolExecutionConfig(this.options.config);
    try {
      const executionPlan = requireExecutionPlan(tool, context);
      const executionProfile = createAgentMcpExecutionProfile({
        backend: executionPlan.backend,
        network: executionPlan.network,
        workspaceMount: executionPlan.workspaceMount,
        packageRoot: handler.server.transport === "http" ? undefined : handler.server.packageRoot,
      });
      const runtime = resolveAgentToolRuntimeCapabilities(tool);
      if (runtime.interactiveInput && !this.options.interactionInput) {
        throw new Error(`Interactive MCP tool ${tool.name} requires the host interaction-input runtime.`);
      }
      const connection = {
        server: handler.server,
        requestTimeoutMs: toolExecution.TimeoutMs,
        spawnPersistentProcess: this.options.executionEnv.spawnPersistentProcess,
        executionProfile,
        terminationGraceMs: toolExecution.Resources.TerminationGraceMs,
        maxFrameBytes: Math.max(toolExecution.MaxStdoutBytes, toolExecution.MaxStderrBytes),
        maxStderrBytes: toolExecution.MaxStderrBytes,
        interactionInput: runtime.interactiveInput ? this.options.interactionInput : undefined,
        sampling: this.sampling,
        onToolsChanged: this.options.onToolsChanged,
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
      const callTool = (client: AgentMcpToolClient) => client.callTool(handler.tool, args, callOptions);
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

      if (agentUnknownRecordOrEmpty(result).isError === true) {
        return mcpToolFailure(extractMcpText(result) || `MCP tool ${handler.tool} failed.`, {
          toolName: tool.name,
          serverId: handler.server,
          mcpToolName: handler.tool,
          mcpIsError: true,
        });
      }
      return toolProcessSuccessResult(projectAgentMcpToolResult(result));
    } catch (error) {
      return mcpToolFailure(
        error,
        {
          toolName: tool.name,
          serverId: handler.server,
          mcpToolName: handler.tool,
        },
        { signal: context.signal, timeoutMs: toolExecution.TimeoutMs },
      );
    }
  }

  close(): Promise<void> {
    return this.ownsClientPool ? this.clients.close() : Promise.resolve();
  }
}

function requireExecutionPlan(tool: RegisteredTool, context: AgentToolRunnerContext) {
  if (!context.executionPlan) {
    throw new Error(`Tool ${tool.name} is missing its resolved execution plan.`);
  }
  return context.executionPlan;
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

export function projectAgentMcpToolResult(result: unknown): unknown {
  const record = agentUnknownRecordOrEmpty(result);
  return isAgentUnknownRecord(record.structuredContent) ? record.structuredContent : { text: extractMcpText(record) };
}

function extractMcpText(value: unknown): string {
  const record = agentUnknownRecordOrEmpty(value);
  const structured = agentUnknownRecordOrEmpty(record.structuredContent);
  if (typeof structured.content === "string") {
    return structured.content;
  }

  const content = Array.isArray(record.content) ? record.content : [];
  return content
    .map((item) => agentUnknownRecordOrEmpty(item).text)
    .filter((text): text is string => typeof text === "string")
    .join("\n");
}

function mcpToolFailure(
  error: unknown,
  details: Record<string, unknown>,
  context: { signal?: AbortSignal; timeoutMs?: number } = {},
): AgentToolProcessRunResult {
  const timedOut = error instanceof McpError && error.code === ErrorCode.RequestTimeout;
  const cancelled = context.signal?.aborted === true;
  const code = timedOut
    ? AgentExecutionErrorCodes.ToolProcessTimeout
    : cancelled
      ? AgentExecutionErrorCodes.ToolProcessCancelled
      : AgentExecutionErrorCodes.ToolExecutionError;
  return toolProcessFailureResult({
    code,
    message: errorMessage(error),
    details: {
      phase: AgentToolProcessErrorPhases.RuntimeExecution,
      ...details,
      ...(timedOut && context.timeoutMs !== undefined ? { timeoutMs: context.timeoutMs } : {}),
      ...(error instanceof McpError ? { mcpErrorCode: error.code } : {}),
    },
  });
}
