import type {
  AgentDecision,
  ExecutedToolCallResult,
} from "./Types/ToolRuntimeTypes.js";
import type { AgentSystemConfig } from "./Types/AgentConfigTypes.js";
import type {
  RegisteredTool,
} from "./Types/PluginRuntimeTypes.js";
import { AgentPluginRegistry } from "./AgentPluginRegistry.js";
import { emitAgentEvent, type AgentEventSink } from "./AgentEvent.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import {
  AgentToolRunner,
  type AgentToolRunnerLike,
} from "./AgentToolRunner.js";
import type { AgentToolHostCapabilityRegistry } from "./AgentToolHostCapabilityRegistry.js";
import { createDefaultHostCapabilityRegistry } from "./AgentDefaultHostCapabilities.js";
import { AgentXmlSourceHelper } from "./AgentXmlParser.js";
import type { AgentXmlProtocolSpec } from "./AgentXmlPolicy.js";
import { AgentDecisionErrorFactory } from "./AgentDecisionErrorFactory.js";
import { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";
import { createToolCallId } from "./AgentIds.js";
import { AgentExecutionErrorCodes } from "./AgentXmlStatus.js";
import type { AgentToolSearchRuntime } from "./AgentToolSearchRuntime.js";
import { createToolProcessSuccessResponse } from "./AgentToolProcessEnvelope.js";
import {
  AgentWorkspaceChangeCapture,
  type PreparedWorkspaceCapture,
} from "./Artifacts/AgentWorkspaceChangeCapture.js";
import { throwIfAborted } from "./AgentCancellation.js";

export type AgentExecutionResult =
  | {
      kind: "ToolResults";
      value: ExecutedToolCallResult[];
    }
  | {
      kind: "AskUser";
      value: AskUserControlResult;
    };

export interface AskUserControlResult {
  question: string;
  reason_code?: string;
}

export interface AgentDecisionExecutionContext {
  requestId?: string;
  step?: number;
  onEvent?: AgentEventSink;
  loadedToolNames?: "all" | readonly string[];
  signal?: AbortSignal;
}

type ToolCallDecision = Extract<AgentDecision, { kind: "ToolCalls" }>["payload"]["tool_call"][number];

type ToolControlResult = {
  kind: "AskUser";
  value: AskUserControlResult;
};

export class AgentDecisionExecutor {
  private readonly toolRunner: AgentToolRunnerLike;
  private readonly errors: AgentDecisionErrorFactory;
  private readonly eventFactory = new AgentLoopEventFactory();
  private readonly workspaceCapture: AgentWorkspaceChangeCapture;

  constructor(
    private readonly registry: AgentPluginRegistry,
    config: AgentSystemConfig,
    private readonly protocol: AgentXmlProtocolSpec,
    toolRunner?: AgentToolRunnerLike,
    errorFactory?: AgentDecisionErrorFactory,
    workspaceRoot?: string,
    hostCapabilities?: AgentToolHostCapabilityRegistry,
    toolSearch?: AgentToolSearchRuntime,
    private readonly configPath?: string,
  ) {
    const resolvedWorkspaceRoot = workspaceRoot ?? process.cwd();
    this.workspaceCapture = new AgentWorkspaceChangeCapture({
      workspaceRoot: resolvedWorkspaceRoot,
    });
    this.toolRunner = toolRunner ?? new AgentToolRunner(
      config,
      protocol,
      resolvedWorkspaceRoot,
      hostCapabilities ?? createDefaultHostCapabilityRegistry({ toolSearch }),
      registry,
    );
    this.errors = errorFactory ?? new AgentDecisionErrorFactory();
  }

  async execute(
    decision: AgentDecision,
    context: AgentDecisionExecutionContext = {},
  ): Promise<AgentExecutionResult> {
    await this.emitToolCallsPlanned(decision, context);

    const plannedCalls = decision.payload.tool_call.map((call, index) => ({
      call,
      index,
      tool: this.resolveTool(decision, call, index, context),
    }));
    const shouldRunSequentially = plannedCalls.some((entry) =>
      entry.tool.artifactPolicy?.Workspace?.Capture
      && entry.tool.artifactPolicy.Workspace.Capture !== "none");
    const runCall = async (entry: typeof plannedCalls[number]) => {
        throwIfAborted(context.signal);
        const callId = createToolCallId();
        const args = entry.call.arguments ?? {};
        const capture = await this.workspaceCapture.prepare({
          policy: entry.tool.artifactPolicy,
          args,
        });
        throwIfAborted(context.signal);
        const execution = await this.runTool(decision, context, entry.tool, args, entry.index, callId);
        throwIfAborted(context.signal);
        const workspaceCapture = await this.completeWorkspaceCapture(capture, execution.response.result);
        throwIfAborted(context.signal);
        const control = this.readToolControlResult(execution.response.result);

        return {
          callId,
          tool: entry.tool,
          args,
          execution,
          workspaceCapture,
          control,
        };
    };
    const results = shouldRunSequentially
      ? []
      : await Promise.all(plannedCalls.map(runCall));
    if (shouldRunSequentially) {
      for (const entry of plannedCalls) {
        results.push(await runCall(entry));
      }
    }

    const controls = results.flatMap((entry) =>
      entry.control ? [{ ...entry, control: entry.control }] : []);
    if (controls.length > 0) {
      if (results.length !== 1) {
        throw this.errors.createRetryable({
          code: AgentExecutionErrorCodes.InvalidToolArguments,
          message: "询问用户的控制工具必须单独调用，不能和其它工具调用混用。",
          diagnostics: controls.map(({ tool }) =>
            new AgentXmlSourceHelper(decision.source.xml).diagnosticForPath(
              `需要暂停并询问用户的工具必须单独调用：${tool.name}`,
              decision.root,
              [this.protocol.items.toolCall, 0, "name"],
              "只保留这一个询问用户的工具调用。",
            )),
          heading: "上一条工具调用组合无效。",
          details: {
            controlTools: controls.map(({ tool }) => tool.name),
          },
        });
      }

      return controls[0].control;
    }

    return {
      kind: "ToolResults",
      value: results.map(({ callId, tool, args, execution, workspaceCapture }) => ({
        callId,
        name: tool.name,
        arguments: args,
        process: {
          exitCode: execution.exitCode,
          signal: execution.signal,
          stderr: execution.stderr,
        },
        result: execution.response.result,
        artifactPolicy: tool.artifactPolicy,
        workspaceCapture,
      })),
    };
  }

  private async completeWorkspaceCapture(
    capture: PreparedWorkspaceCapture,
    result: unknown,
  ) {
    return capture.complete(result);
  }

  private resolveTool(
    decision: Extract<AgentDecision, { kind: "ToolCalls" }>,
    call: ToolCallDecision,
    callIndex: number,
    context: AgentDecisionExecutionContext,
  ): RegisteredTool {
    const tool = this.registry.getTool(call.name);
    const allowedTools = this.allowedToolNames(context.loadedToolNames);
    if (!tool || !allowedTools.has(call.name)) {
      throw this.errors.unknownToolName({
        rootName: decision.root,
        source: new AgentXmlSourceHelper(decision.source.xml),
        protocol: this.protocol,
        callIndex,
        toolName: call.name,
        allowedTools: [...allowedTools],
      });
    }

    return tool;
  }

  private allowedToolNames(loadedToolNames: AgentDecisionExecutionContext["loadedToolNames"]): Set<string> {
    const tools = this.registry.listTools();
    if (!loadedToolNames || loadedToolNames === "all") {
      return new Set(tools.map((tool) => tool.name));
    }

    const registered = new Set(tools.map((tool) => tool.name));
    return new Set(loadedToolNames.filter((toolName) => registered.has(toolName)));
  }

  private async runTool(
    decision: Extract<AgentDecision, { kind: "ToolCalls" }>,
    context: AgentDecisionExecutionContext,
    tool: RegisteredTool,
    args: Record<string, unknown>,
    index: number,
    callId: string,
  ): Promise<AgentToolProcessRunResult> {
    await this.emitToolCallStarted(context, index, tool.name, callId);
    throwIfAborted(context.signal);
    const execution = await this.toolRunner.run(tool, args, {
      requestId: context.requestId,
      step: context.step,
      configPath: this.configPath,
      onEvent: context.onEvent,
      visibleToolNames: context.loadedToolNames === "all" ? undefined : context.loadedToolNames,
      signal: context.signal,
    });
    throwIfAborted(context.signal);

    if (!execution.response.ok) {
      await this.emitToolCallFailed(context, index, tool.name, callId, execution.response.error);

      if (!execution.response.error) {
        throw new Error(`工具进程返回失败但缺少 error：${tool.name}`);
      }

      if (execution.response.error.code === AgentExecutionErrorCodes.InvalidToolArguments) {
        throw this.errors.toolExecutionFailure({
          rootName: decision.root,
          source: new AgentXmlSourceHelper(decision.source.xml),
          protocol: this.protocol,
          callIndex: index,
          toolName: tool.name,
          error: execution.response.error,
        });
      }

      return {
        ...execution,
        response: createToolProcessSuccessResponse({
          error: execution.response.error,
        }),
      };
    }

    await this.emitToolCallCompleted(
      context,
      index,
      tool.name,
      callId,
      execution.response.result,
    );
    return execution;
  }

  private readToolControlResult(result: unknown): ToolControlResult | undefined {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return undefined;
    }

    const control = (result as Record<string, unknown>).control;
    if (!control || typeof control !== "object" || Array.isArray(control)) {
      return undefined;
    }

    const record = control as Record<string, unknown>;
    if (record.kind !== "AskUser") {
      return undefined;
    }

    const question = typeof record.question === "string" ? record.question.trim() : "";
    if (!question) {
      throw new Error("AskUser 控制结果缺少 question。");
    }

    return {
      kind: "AskUser",
      value: {
        question,
        reason_code: this.readOptionalString(record, "reason_code"),
      },
    };
  }

  private readOptionalString(
    value: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const text = typeof value[key] === "string" ? value[key].trim() : "";
    return text.length > 0 ? text : undefined;
  }

  private async emitToolCallsPlanned(
    decision: Extract<AgentDecision, { kind: "ToolCalls" }>,
    context: AgentDecisionExecutionContext,
  ): Promise<void> {
    if (!context.requestId || context.step === undefined) {
      return;
    }

    await emitAgentEvent(
      context.onEvent,
      this.eventFactory.toolCallsPlanned(
        context.requestId,
        context.step,
        decision.payload.tool_call.map((entry) => entry.name),
      ),
    );
  }

  private async emitToolCallStarted(
    context: AgentDecisionExecutionContext,
    index: number,
    toolName: string,
    callId: string,
  ): Promise<void> {
    if (!context.requestId || context.step === undefined) {
      return;
    }

    await emitAgentEvent(
      context.onEvent,
      this.eventFactory.toolCallStarted(context.requestId, context.step, index, toolName, callId),
    );
  }

  private async emitToolCallCompleted(
    context: AgentDecisionExecutionContext,
    index: number,
    toolName: string,
    callId: string,
    result: unknown,
  ): Promise<void> {
    if (!context.requestId || context.step === undefined) {
      return;
    }

    await emitAgentEvent(
      context.onEvent,
      this.eventFactory.toolCallCompleted(
        context.requestId,
        context.step,
        index,
        toolName,
        callId,
        this.previewToolResult(result),
      ),
    );
  }

  private async emitToolCallFailed(
    context: AgentDecisionExecutionContext,
    index: number,
    toolName: string,
    callId: string,
    error: AgentToolProcessRunResult["response"]["error"] | undefined,
  ): Promise<void> {
    if (!context.requestId || context.step === undefined || !error) {
      return;
    }

    await emitAgentEvent(
      context.onEvent,
      this.eventFactory.toolCallFailed(
        context.requestId,
        context.step,
        index,
        toolName,
        callId,
        error.message,
        error.code,
      ),
    );
  }

  private previewToolResult(result: unknown): string | undefined {
    const shellPreview = this.previewShellResult(result);
    if (shellPreview) {
      return shellPreview;
    }

    if (typeof result === "string") {
      return result.length > 160 ? `${result.slice(0, 157)}...` : result;
    }

    if (typeof result === "number" || typeof result === "boolean" || typeof result === "bigint") {
      return String(result);
    }

    if (Array.isArray(result)) {
      return `${result.length} 项`;
    }

    if (result && typeof result === "object") {
      return Object.keys(result as Record<string, unknown>).slice(0, 4).join(", ");
    }

    return undefined;
  }

  private previewShellResult(result: unknown): string | undefined {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return undefined;
    }

    const record = result as Record<string, unknown>;
    const command = typeof record.command === "string" ? record.command : undefined;
    const exitCode = typeof record.exitCode === "number" ? record.exitCode : undefined;
    const stdout = typeof record.stdout === "string" ? record.stdout.trim() : "";
    const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
    if (!command || exitCode === undefined) {
      return undefined;
    }

    const text = stderr || stdout;
    const suffix = text ? ` · ${text.slice(0, 120)}` : "";
    return `exit ${exitCode} · ${command}${suffix}`;
  }

  private toolCallPath(
    callIndex: number,
    ...path: Array<string | number>
  ): Array<string | number> {
    return [this.protocol.items.toolCall, callIndex, ...path];
  }
}
