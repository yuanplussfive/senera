import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import {
  AgentToolRunner,
  type AgentToolRunnerLike,
} from "../ToolRuntime/AgentToolRunner.js";
import type { AgentToolHostCapabilityRegistry } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { createDefaultHostCapabilityRegistry } from "../AgentDefaultHostCapabilities.js";
import type { AgentXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import { AgentDecisionErrorFactory } from "./AgentDecisionErrorFactory.js";
import type { AgentToolSearchRuntime } from "../ToolSearch/AgentToolSearchRuntime.js";
import { AgentWorkspaceChangeCapture } from "../Artifacts/AgentWorkspaceChangeCapture.js";
import type {
  AgentDecisionExecutionContext,
  AgentExecutionResult,
  AgentToolCallsDecision,
  ExecutedDecisionToolCall,
  ResolvedDecisionToolCall,
} from "./AgentDecisionExecutionTypes.js";
import { AgentDecisionToolResolver } from "./AgentDecisionToolResolver.js";
import { AgentDecisionToolEventEmitter } from "./AgentDecisionToolEventEmitter.js";
import { AgentDecisionToolControlPolicy } from "./AgentDecisionToolControl.js";
import { AgentDecisionToolCallRunner } from "./AgentDecisionToolCallRunner.js";

export type {
  AgentDecisionExecutionContext,
  AgentExecutionResult,
  AgentToolCallsDecision,
  AskUserControlResult,
} from "./AgentDecisionExecutionTypes.js";

export class AgentDecisionExecutor {
  private readonly events = new AgentDecisionToolEventEmitter();
  private readonly toolResolver: AgentDecisionToolResolver;
  private readonly toolCallRunner: AgentDecisionToolCallRunner;
  private readonly controls: AgentDecisionToolControlPolicy;

  constructor(
    registry: AgentPluginRegistry,
    config: AgentSystemConfig,
    protocol: AgentXmlProtocolSpec,
    toolRunner?: AgentToolRunnerLike,
    errorFactory?: AgentDecisionErrorFactory,
    workspaceRoot?: string,
    hostCapabilities?: AgentToolHostCapabilityRegistry,
    toolSearch?: AgentToolSearchRuntime,
    configPath?: string,
  ) {
    const resolvedWorkspaceRoot = workspaceRoot ?? process.cwd();
    const errors = errorFactory ?? new AgentDecisionErrorFactory();
    const workspaceCapture = new AgentWorkspaceChangeCapture({
      workspaceRoot: resolvedWorkspaceRoot,
    });
    const resolvedToolRunner = toolRunner ?? new AgentToolRunner(
      config,
      protocol,
      resolvedWorkspaceRoot,
      hostCapabilities ?? createDefaultHostCapabilityRegistry({ toolSearch }),
      registry,
    );

    this.controls = new AgentDecisionToolControlPolicy(errors, protocol);
    this.toolResolver = new AgentDecisionToolResolver(registry, errors, protocol);
    this.toolCallRunner = new AgentDecisionToolCallRunner({
      toolRunner: resolvedToolRunner,
      events: this.events,
      controls: this.controls,
      errors,
      protocol,
      workspaceCapture,
      configPath,
    });
  }

  async execute(
    decision: AgentToolCallsDecision,
    context: AgentDecisionExecutionContext = {},
  ): Promise<AgentExecutionResult> {
    await this.events.emitPlanned(decision, context);

    const plannedCalls = this.resolveToolCalls(decision, context);
    const results = await this.runToolCalls(decision, context, plannedCalls);
    const control = this.controls.selectExclusive(decision, results);
    if (control) {
      return control;
    }

    return {
      kind: "ToolResults",
      value: results.map(toExecutedToolCallResult),
    };
  }

  private resolveToolCalls(
    decision: AgentToolCallsDecision,
    context: AgentDecisionExecutionContext,
  ): ResolvedDecisionToolCall[] {
    return decision.payload.tool_call.map((call, index) => ({
      call,
      index,
      tool: this.toolResolver.resolve(decision, call, index, context),
    }));
  }

  private async runToolCalls(
    decision: AgentToolCallsDecision,
    context: AgentDecisionExecutionContext,
    plannedCalls: readonly ResolvedDecisionToolCall[],
  ): Promise<ExecutedDecisionToolCall[]> {
    return shouldRunSequentially(plannedCalls)
      ? this.runSequentially(decision, context, plannedCalls)
      : Promise.all(plannedCalls.map((entry) =>
          this.toolCallRunner.run(decision, context, entry)));
  }

  private async runSequentially(
    decision: AgentToolCallsDecision,
    context: AgentDecisionExecutionContext,
    plannedCalls: readonly ResolvedDecisionToolCall[],
  ): Promise<ExecutedDecisionToolCall[]> {
    const results: ExecutedDecisionToolCall[] = [];
    for (const entry of plannedCalls) {
      results.push(await this.toolCallRunner.run(decision, context, entry));
    }
    return results;
  }
}

function shouldRunSequentially(plannedCalls: readonly ResolvedDecisionToolCall[]): boolean {
  return plannedCalls.some((entry) =>
    entry.tool.artifactPolicy?.Workspace?.Capture
    && entry.tool.artifactPolicy.Workspace.Capture !== "none");
}

function toExecutedToolCallResult(entry: ExecutedDecisionToolCall): ExecutedToolCallResult {
  return {
    callId: entry.callId,
    name: entry.tool.name,
    arguments: entry.args,
    process: {
      exitCode: entry.execution.exitCode,
      signal: entry.execution.signal,
      stderr: entry.execution.stderr,
    },
    result: entry.execution.response.result,
    artifactPolicy: entry.tool.artifactPolicy,
    workspaceCapture: entry.workspaceCapture,
  };
}
