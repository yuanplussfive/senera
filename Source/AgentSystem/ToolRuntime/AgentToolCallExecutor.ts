import { AgentWorkspaceChangeCapture } from "../Artifacts/AgentWorkspaceChangeCapture.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { createToolCallId } from "../Core/AgentIds.js";
import { emitAgentEvent } from "../Events/AgentEvent.js";
import { AgentLoopEventFactory } from "../Loop/AgentLoopEventFactory.js";
import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { createDefaultHostCapabilityRegistry } from "../AgentDefaultHostCapabilities.js";
import type { AgentToolHostCapabilityRegistry } from "./AgentToolHostCapabilityRegistry.js";
import {
  AgentToolRunner,
  type AgentToolRunnerLike,
} from "./AgentToolRunner.js";
import type { AgentToolSearchRuntime } from "../ToolSearch/AgentToolSearchRuntime.js";
import type { AgentXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { SeneraLocalExecutionEnv } from "../Execution/SeneraLocalExecutionEnv.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { projectAgentToolResultPresentation } from "./AgentToolResultPresentation.js";
import type {
  AgentToolCallExecutionContext,
  AgentToolCallExecutionRequest,
  AgentToolCallExecutionResult,
  AskUserControlResult,
} from "./AgentToolCallExecutionTypes.js";

export interface AgentToolCallExecutorOptions {
  registry: AgentPluginRegistry;
  config: AgentSystemConfig;
  protocol: AgentXmlProtocolSpec;
  toolRunner?: AgentToolRunnerLike;
  workspaceRoot?: string;
  hostCapabilities?: AgentToolHostCapabilityRegistry;
  toolSearch?: AgentToolSearchRuntime;
  executionEnv?: SeneraExecutionEnv;
  configPath?: string;
  emitLifecycleEvents?: boolean;
}

export class AgentToolCallExecutor {
  private readonly events = new AgentLoopEventFactory();
  private readonly toolRunner: AgentToolRunnerLike;
  private readonly workspaceCapture: AgentWorkspaceChangeCapture;
  private readonly emitLifecycleEvents: boolean;

  constructor(private readonly options: AgentToolCallExecutorOptions) {
    const workspaceRoot = options.workspaceRoot ?? process.cwd();
    const executionEnv = options.executionEnv ?? new SeneraLocalExecutionEnv({
      workspaceRoot,
    });
    this.emitLifecycleEvents = options.emitLifecycleEvents ?? true;
    this.workspaceCapture = new AgentWorkspaceChangeCapture({
      workspaceRoot,
    });
    this.toolRunner = options.toolRunner ?? new AgentToolRunner(
      options.config,
      options.protocol,
      workspaceRoot,
      options.hostCapabilities ?? createDefaultHostCapabilityRegistry({
        toolSearch: options.toolSearch,
      }),
      options.registry,
      executionEnv,
    );
  }

  async execute(
    request: AgentToolCallExecutionRequest,
    context: AgentToolCallExecutionContext = {},
  ): Promise<AgentToolCallExecutionResult> {
    const tool = this.resolveTool(request.name, context.loadedToolNames);
    const result = await this.runToolCall(tool, request, context);
    const control = readAskUserControl(result.result);

    return control
      ? {
          kind: "AskUser",
          value: control,
        }
      : {
          kind: "ToolResults",
          value: [result],
        };
  }

  private resolveTool(
    toolName: string,
    loadedToolNames: AgentToolCallExecutionContext["loadedToolNames"],
  ): RegisteredTool {
    const tool = this.options.registry.getTool(toolName);
    const allowedTools = this.allowedToolNames(loadedToolNames);
    if (!tool || !allowedTools.has(toolName)) {
      throw new Error(agentErrorMessage("tool.notRegisteredOrVisible", { toolName }));
    }

    return tool;
  }

  private async runToolCall(
    tool: RegisteredTool,
    request: AgentToolCallExecutionRequest,
    context: AgentToolCallExecutionContext,
  ): Promise<ExecutedToolCallResult> {
    throwIfAborted(context.signal);
    const callId = request.callId ?? createToolCallId();
    const index = request.index ?? 0;
    const args = request.arguments ?? {};
    const capture = await this.workspaceCapture.prepare({
      policy: tool.artifactPolicy,
      args,
    });

    if (!context.batchId) {
      await this.emitLifecycle(context, () =>
        this.events.toolCallsPlanned(
          context.requestId!,
          context.step!,
          [tool.name],
        ));
    }
    await this.emitLifecycle(context, () =>
      this.events.toolCallStarted(context.requestId!, context.step!, index, tool.name, callId, {
        batchId: context.batchId,
      }));

    throwIfAborted(context.signal);
    const execution = await this.toolRunner.run(tool, args, {
      requestId: context.requestId,
      step: context.step,
      configPath: this.options.configPath,
      onEvent: context.onEvent,
      visibleToolNames: context.loadedToolNames === "all" ? undefined : context.loadedToolNames,
      signal: context.signal,
    });
    throwIfAborted(context.signal);

    const result = execution.response.ok
      ? execution.response.result
      : { error: execution.response.error };
    const workspaceCapture = await capture.complete(result);
    const executedBase: ExecutedToolCallResult = {
      callId,
      name: tool.name,
      arguments: args,
      process: {
        exitCode: execution.exitCode,
        signal: execution.signal,
        stderr: execution.stderr,
      },
      result,
      artifactPolicy: tool.artifactPolicy,
      workspaceCapture,
    };
    const executed: ExecutedToolCallResult = {
      ...executedBase,
      presentation: projectAgentToolResultPresentation(executedBase),
    };

    await this.emitResultLifecycle(context, index, executed);
    return executed;
  }

  private async emitResultLifecycle(
    context: AgentToolCallExecutionContext,
    index: number,
    result: ExecutedToolCallResult,
  ): Promise<void> {
    const error = readStructuredToolError(result.result);
    await this.emitLifecycle(context, () =>
      error
        ? this.events.toolCallFailed(
            context.requestId!,
            context.step!,
            index,
            result.name,
            result.callId,
            error.message,
            error.code,
            { batchId: context.batchId },
          )
        : this.events.toolCallCompleted(
            context.requestId!,
            context.step!,
            index,
            result.name,
            result.callId,
            result.presentation ?? projectAgentToolResultPresentation(result),
            { batchId: context.batchId },
          ));
    await this.emitLifecycle(context, () =>
      this.events.toolCallResultDetail(
        context.requestId!,
        context.step!,
        index,
        result.name,
        result.callId,
        result,
        { batchId: context.batchId },
      ));
  }

  private async emitLifecycle(
    context: AgentToolCallExecutionContext,
    create: () => Parameters<typeof emitAgentEvent>[1],
  ): Promise<void> {
    if (!this.emitLifecycleEvents || !context.requestId || context.step === undefined) {
      return;
    }

    await emitAgentEvent(context.onEvent, create());
  }

  private allowedToolNames(
    loadedToolNames: AgentToolCallExecutionContext["loadedToolNames"],
  ): Set<string> {
    const tools = this.options.registry.listTools();
    if (!loadedToolNames || loadedToolNames === "all") {
      return new Set(tools.map((tool) => tool.name));
    }

    const registered = new Set(tools.map((tool) => tool.name));
    return new Set(loadedToolNames.filter((toolName) => registered.has(toolName)));
  }
}

function readAskUserControl(value: unknown): AskUserControlResult | undefined {
  const control = readRecord(value)?.control;
  const record = readRecord(control);
  if (record?.kind !== "AskUser") {
    return undefined;
  }

  const question = readRequiredText(
    record,
    "question",
    agentErrorMessage("tool.askUserControlMissingQuestion"),
  );
  const reason = readOptionalText(record, "reason_code");
  return reason
    ? {
        question,
        reason_code: reason,
      }
    : { question };
}

function readStructuredToolError(value: unknown): { code?: string; message: string } | undefined {
  const error = readRecord(readRecord(value)?.error);
  if (!error) {
    return undefined;
  }

  return {
    code: readOptionalText(error, "code"),
    message: readOptionalText(error, "message") ?? JSON.stringify(error),
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readRequiredText(
  value: Record<string, unknown>,
  key: string,
  message: string,
): string {
  const text = readOptionalText(value, key);
  if (!text) {
    throw new Error(message);
  }

  return text;
}

function readOptionalText(value: Record<string, unknown>, key: string): string | undefined {
  const text = typeof value[key] === "string" ? value[key].trim() : "";
  return text.length > 0 ? text : undefined;
}
