import type { AgentToolPermissionGate } from "../Safety/AgentToolPermissionGate.js";
import { AgentToolPermissionDeniedError } from "../Safety/AgentToolPermissionGate.js";
import { projectAgentToolSafetyMetadata } from "../Safety/AgentToolSafetyMetadata.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { AgentPiToolProjectionContext } from "./AgentPiTypes.js";
import {
  AgentToolExecutionTargetError,
  projectSeneraProcessBackendsToToolTargets,
  resolveAgentToolInvocation,
} from "../ToolRuntime/AgentToolExecutionPlan.js";
import { isAgentToolAuthorized } from "../ToolRuntime/AgentToolAccessGrant.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentPiToolCallPreflightInput, AgentPiToolCallPreflightResult } from "./AgentPiToolCallPreflight.js";
import type { SeneraExecutionRuntimeCapabilities } from "../Execution/SeneraExecutionRuntimeCapabilities.js";
import type { AgentToolResourceCapabilityRegistry } from "../ToolRuntime/AgentToolResourceCapabilityRegistry.js";
import { inspectAgentToolResourceAccess } from "../ToolRuntime/AgentToolResourceCapabilities.js";

export interface AgentPiToolPermissionHookOptions {
  registry: AgentExtensionRegistry;
  permissionGate?: AgentToolPermissionGate;
  executionCapabilities: () => SeneraExecutionRuntimeCapabilities;
  resourceCapabilities: AgentToolResourceCapabilityRegistry;
}

export type AgentPiToolCallHookEvent = AgentPiToolCallPreflightInput;

export type AgentPiToolCallHookResult = AgentPiToolCallPreflightResult;

export class AgentPiToolPermissionHook {
  constructor(private readonly options: AgentPiToolPermissionHookOptions) {}

  async authorize(
    context: AgentPiToolProjectionContext,
    event: AgentPiToolCallHookEvent,
  ): Promise<AgentPiToolCallHookResult | undefined> {
    const toolAccessGrant = context.toolAccessGrant;
    if (!toolAccessGrant) return { block: true, reason: agentErrorMessage("toolAccess.missingGrant") };
    if (!isAgentToolAuthorized(toolAccessGrant, event.toolName)) {
      return {
        block: true,
        reason: agentErrorMessage("tool.notRegisteredOrAllowed", { toolName: event.toolName }),
      };
    }
    if (context.toolExposure && !context.toolExposure.exposes(event.toolName)) {
      return {
        block: true,
        reason: agentErrorMessage("tool.notRegisteredOrAllowed", { toolName: event.toolName }),
      };
    }
    const tool = this.options.registry.getTool(event.toolName);
    let invocation;
    try {
      invocation = tool
        ? resolveAgentToolInvocation(
            tool,
            event.input,
            projectSeneraProcessBackendsToToolTargets(this.options.executionCapabilities().processBackends),
          )
        : undefined;
    } catch (error) {
      if (error instanceof AgentToolExecutionTargetError) {
        return { block: true, reason: error.message };
      }
      throw error;
    }
    if (!this.options.permissionGate) {
      return undefined;
    }
    const approvalMode = context.approvalMode ?? context.turnState?.context.approvalMode;
    if (!approvalMode) {
      return { block: true, reason: agentErrorMessage("toolAccess.missingApprovalMode") };
    }
    const sessionId =
      context.sessionId ??
      context.turnState?.context.sessionId ??
      context.requestId ??
      context.turnState?.context.requestId ??
      event.toolCallId;
    const requestId = context.requestId ?? context.turnState?.context.requestId ?? event.toolCallId;
    const step = context.step ?? context.turnState?.context.step ?? 1;
    try {
      const resourceAccess = tool
        ? await inspectAgentToolResourceAccess(
            tool,
            invocation?.arguments ?? event.input,
            this.options.resourceCapabilities,
          )
        : undefined;
      const decision = await this.options.permissionGate.authorize({
        approvalMode,
        sessionId,
        requestId,
        toolCallId: event.toolCallId,
        batchId: context.turnState?.toolBatchId(event.toolCallId),
        step,
        toolName: event.toolName,
        arguments: invocation?.arguments ?? event.input,
        executionPlan: invocation?.executionPlan,
        resourceAccess,
        toolAccessGrant,
        tool: tool ? projectAgentToolSafetyMetadata(tool) : undefined,
        runtimeContext: {
          requestId,
          step,
          rootCommand: context.rootCommand,
          activeSkills: context.activeSkills?.map((skill) => ({
            name: skill.name,
            title: skill.title,
            summary: skill.summary,
            matchedTerms: skill.matchedTerms,
            score: skill.score,
          })),
        },
        onEvent: context.onEvent,
        signal: context.signal,
      });
      if (decision?.resourceGrant) {
        context.turnState?.registerResourceAccessGrant(event.toolCallId, decision.resourceGrant);
      }
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
