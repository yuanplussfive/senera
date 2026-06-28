import { throwIfAborted } from "../AgentCancellation.js";
import { createToolCallId } from "../AgentIds.js";
import {
  AgentWorkspaceChangeCapture,
  type PreparedWorkspaceCapture,
} from "../Artifacts/AgentWorkspaceChangeCapture.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessRunner.js";
import type { AgentToolRunnerLike } from "../ToolRuntime/AgentToolRunner.js";
import { createToolProcessSuccessResponse } from "../ToolRuntime/AgentToolProcessEnvelope.js";
import { AgentXmlSourceHelper } from "../Xml/AgentXmlParser.js";
import type { AgentXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import { AgentExecutionErrorCodes } from "../Xml/AgentXmlStatus.js";
import { AgentDecisionErrorFactory } from "./AgentDecisionErrorFactory.js";
import type {
  AgentDecisionExecutionContext,
  AgentToolCallsDecision,
  ExecutedDecisionToolCall,
  ResolvedDecisionToolCall,
} from "./AgentDecisionExecutionTypes.js";
import { AgentDecisionToolControlPolicy } from "./AgentDecisionToolControl.js";
import { AgentDecisionToolEventEmitter } from "./AgentDecisionToolEventEmitter.js";

export interface AgentDecisionToolCallRunnerOptions {
  toolRunner: AgentToolRunnerLike;
  events: AgentDecisionToolEventEmitter;
  controls: AgentDecisionToolControlPolicy;
  errors: AgentDecisionErrorFactory;
  protocol: AgentXmlProtocolSpec;
  workspaceCapture: AgentWorkspaceChangeCapture;
  configPath?: string;
}

export class AgentDecisionToolCallRunner {
  constructor(private readonly options: AgentDecisionToolCallRunnerOptions) {}

  async run(
    decision: AgentToolCallsDecision,
    context: AgentDecisionExecutionContext,
    entry: ResolvedDecisionToolCall,
  ): Promise<ExecutedDecisionToolCall> {
    throwIfAborted(context.signal);
    const callId = createToolCallId();
    const args = entry.call.arguments ?? {};
    const capture = await this.options.workspaceCapture.prepare({
      policy: entry.tool.artifactPolicy,
      args,
    });

    throwIfAborted(context.signal);
    const execution = await this.runProcess(decision, context, entry.tool, args, entry.index, callId);
    throwIfAborted(context.signal);
    const workspaceCapture = await this.completeWorkspaceCapture(capture, execution.response.result);
    throwIfAborted(context.signal);

    return {
      callId,
      index: entry.index,
      tool: entry.tool,
      args,
      execution,
      workspaceCapture,
      control: this.options.controls.read(execution.response.result),
    };
  }

  private async completeWorkspaceCapture(
    capture: PreparedWorkspaceCapture,
    result: unknown,
  ) {
    return capture.complete(result);
  }

  private async runProcess(
    decision: AgentToolCallsDecision,
    context: AgentDecisionExecutionContext,
    tool: RegisteredTool,
    args: Record<string, unknown>,
    index: number,
    callId: string,
  ): Promise<AgentToolProcessRunResult> {
    await this.options.events.emitStarted(context, index, tool.name, callId);
    throwIfAborted(context.signal);
    const execution = await this.options.toolRunner.run(tool, args, {
      requestId: context.requestId,
      step: context.step,
      configPath: this.options.configPath,
      onEvent: context.onEvent,
      visibleToolNames: context.loadedToolNames === "all" ? undefined : context.loadedToolNames,
      signal: context.signal,
    });
    throwIfAborted(context.signal);

    return execution.response.ok
      ? this.handleSuccess(context, index, tool.name, callId, execution)
      : this.handleFailure(decision, context, index, tool, callId, execution);
  }

  private async handleSuccess(
    context: AgentDecisionExecutionContext,
    index: number,
    toolName: string,
    callId: string,
    execution: AgentToolProcessRunResult,
  ): Promise<AgentToolProcessRunResult> {
    await this.options.events.emitCompleted(
      context,
      index,
      toolName,
      callId,
      execution.response.result,
    );
    return execution;
  }

  private async handleFailure(
    decision: AgentToolCallsDecision,
    context: AgentDecisionExecutionContext,
    index: number,
    tool: RegisteredTool,
    callId: string,
    execution: AgentToolProcessRunResult,
  ): Promise<AgentToolProcessRunResult> {
    await this.options.events.emitFailed(context, index, tool.name, callId, execution.response.error);

    if (!execution.response.error) {
      throw new Error(`工具进程返回失败但缺少 error：${tool.name}`);
    }

    if (execution.response.error.code === AgentExecutionErrorCodes.InvalidToolArguments) {
      throw this.options.errors.toolExecutionFailure({
        rootName: decision.root,
        source: new AgentXmlSourceHelper(decision.source.xml),
        protocol: this.options.protocol,
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
}
