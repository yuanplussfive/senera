import {
  emitAgentEvent,
  type AgentEventSink,
} from "../Events/AgentEvent.js";
import { AgentLoopEventFactory } from "../Loop/AgentLoopEventFactory.js";
import type { AgentToolProcessRunResult } from "../ToolRuntime/AgentToolProcessRunner.js";
import type {
  AgentDecisionExecutionContext,
  AgentToolCallsDecision,
} from "./AgentDecisionExecutionTypes.js";

export class AgentDecisionToolEventEmitter {
  private readonly eventFactory = new AgentLoopEventFactory();

  async emitPlanned(
    decision: AgentToolCallsDecision,
    context: AgentDecisionExecutionContext,
  ): Promise<void> {
    await this.emitWhenContextPresent(context, (requestId, step) =>
      this.eventFactory.toolCallsPlanned(
        requestId,
        step,
        decision.payload.tool_call.map((entry) => entry.name),
      ));
  }

  async emitStarted(
    context: AgentDecisionExecutionContext,
    index: number,
    toolName: string,
    callId: string,
  ): Promise<void> {
    await this.emitWhenContextPresent(context, (requestId, step) =>
      this.eventFactory.toolCallStarted(requestId, step, index, toolName, callId));
  }

  async emitCompleted(
    context: AgentDecisionExecutionContext,
    index: number,
    toolName: string,
    callId: string,
    result: unknown,
  ): Promise<void> {
    await this.emitWhenContextPresent(context, (requestId, step) =>
      this.eventFactory.toolCallCompleted(
        requestId,
        step,
        index,
        toolName,
        callId,
        previewToolResult(result),
      ));
  }

  async emitFailed(
    context: AgentDecisionExecutionContext,
    index: number,
    toolName: string,
    callId: string,
    error: AgentToolProcessRunResult["response"]["error"] | undefined,
  ): Promise<void> {
    if (!error) {
      return;
    }

    await this.emitWhenContextPresent(context, (requestId, step) =>
      this.eventFactory.toolCallFailed(
        requestId,
        step,
        index,
        toolName,
        callId,
        error.message,
        error.code,
      ));
  }

  private async emitWhenContextPresent(
    context: AgentDecisionExecutionContext,
    create: (requestId: string, step: number) => Parameters<typeof emitAgentEvent>[1],
  ): Promise<void> {
    if (!context.requestId || context.step === undefined) {
      return;
    }

    await emitAgentEvent(
      context.onEvent as AgentEventSink | undefined,
      create(context.requestId, context.step),
    );
  }
}

function previewToolResult(result: unknown): string | undefined {
  return previewShellResult(result)
    ?? previewPrimitiveResult(result)
    ?? previewCollectionResult(result);
}

function previewPrimitiveResult(result: unknown): string | undefined {
  if (typeof result === "string") {
    return result.length > 160 ? `${result.slice(0, 157)}...` : result;
  }

  return typeof result === "number"
    || typeof result === "boolean"
    || typeof result === "bigint"
    ? String(result)
    : undefined;
}

function previewCollectionResult(result: unknown): string | undefined {
  if (Array.isArray(result)) {
    return `${result.length} 项`;
  }

  return result && typeof result === "object"
    ? Object.keys(result as Record<string, unknown>).slice(0, 4).join(", ")
    : undefined;
}

function previewShellResult(result: unknown): string | undefined {
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
