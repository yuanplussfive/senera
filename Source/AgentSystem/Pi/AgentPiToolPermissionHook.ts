import type { AgentToolPermissionGate } from "../Safety/AgentToolPermissionGate.js";
import { AgentToolPermissionDeniedError } from "../Safety/AgentToolPermissionGate.js";
import { projectAgentToolSafetyMetadata } from "../Safety/AgentToolSafetyMetadata.js";
import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import type { AgentPiToolProjectionContext } from "./AgentPiTypes.js";
import { readPiProxyToolCallBatchId } from "../PiProxy/AgentPiProxyRuntimeContext.js";
import { AgentToolExecutionTargetError, resolveAgentToolInvocation } from "../ToolRuntime/AgentToolExecutionPlan.js";

export interface AgentPiToolPermissionHookOptions {
  registry: AgentPluginRegistry;
  permissionGate?: AgentToolPermissionGate;
}

export interface AgentPiToolCallHookEvent {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface AgentPiToolCallHookResult {
  block?: boolean;
  reason?: string;
}

export class AgentPiToolPermissionHook {
  constructor(private readonly options: AgentPiToolPermissionHookOptions) {}

  async authorize(
    context: AgentPiToolProjectionContext,
    event: AgentPiToolCallHookEvent,
  ): Promise<AgentPiToolCallHookResult | undefined> {
    if (!this.options.permissionGate) {
      return undefined;
    }

    const tool = this.options.registry.getTool(event.toolName);
    let invocation;
    try {
      invocation = tool ? resolveAgentToolInvocation(tool, event.input) : undefined;
    } catch (error) {
      if (error instanceof AgentToolExecutionTargetError) {
        return { block: true, reason: error.message };
      }
      throw error;
    }
    try {
      await this.options.permissionGate.authorize({
        sessionId: context.sessionId ?? context.requestId ?? event.toolCallId,
        requestId: context.requestId ?? event.toolCallId,
        toolCallId: event.toolCallId,
        batchId: readPiProxyToolCallBatchId(context.piProxyRuntimeContextId, event.toolCallId),
        step: context.step ?? 1,
        toolName: event.toolName,
        arguments: invocation?.arguments ?? event.input,
        executionPlan: invocation?.executionPlan,
        visibleToolNames: context.visibleToolNames,
        tool: tool ? projectAgentToolSafetyMetadata(tool) : undefined,
        runtimeContext: {
          requestId: context.requestId,
          step: context.step,
          rootCommand: context.rootCommand,
          activeSkills: context.activeSkills?.map((skill) => ({
            name: skill.name,
            title: skill.title,
            summary: skill.summary,
            matchedTerms: skill.matchedTerms,
            score: skill.score,
          })),
          turnUnderstanding: context.turnUnderstanding,
        },
        onEvent: context.onEvent,
        signal: context.signal,
      });
      return undefined;
    } catch (error) {
      if (error instanceof AgentToolPermissionDeniedError) {
        return {
          block: true,
          reason: error.message,
        };
      }
      throw error;
    }
  }
}
