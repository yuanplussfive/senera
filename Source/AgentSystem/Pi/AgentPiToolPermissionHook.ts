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
import { isAgentToolAvailableForInteraction } from "../ToolRuntime/AgentToolInteractionAvailability.js";
import {
  isAgentToolDynamicallyDiscoverable,
  isAgentToolSupportedByPlanningMode,
} from "../ToolRuntime/AgentToolInvocationRouting.js";
import type { AgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelEndpointContract.js";
import { AgentBrowserMaximumUrlLength } from "../Browser/AgentBrowserConfiguration.js";
import { AgentBrowserNetworkPermissionId, inspectAgentBrowserTarget } from "../Browser/AgentBrowserUrlPolicy.js";
import { AgentExecutionApprovalModes } from "../Safety/AgentExecutionApprovalMode.js";
import { AgentWebUrlPolicyError } from "../Web/AgentWebUrlPolicy.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";

export interface AgentPiToolPermissionHookOptions {
  registry: AgentExtensionRegistry;
  toolPlanningMode: AgentModelToolPlanningMode;
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
    options: { readonly requireExposure?: boolean } = {},
  ): Promise<AgentPiToolCallHookResult | undefined> {
    try {
      const result = await this.authorizeCore(context, event, options);
      if (result?.block) context.turnState?.skipWorkspaceChangeCall(event.toolCallId);
      return result;
    } catch (error) {
      context.turnState?.skipWorkspaceChangeCall(event.toolCallId);
      throw error;
    }
  }

  private async authorizeCore(
    context: AgentPiToolProjectionContext,
    event: AgentPiToolCallHookEvent,
    options: { readonly requireExposure?: boolean },
  ): Promise<AgentPiToolCallHookResult | undefined> {
    const toolAccessGrant = context.toolAccessGrant;
    if (!toolAccessGrant) return { block: true, reason: agentErrorMessage("toolAccess.missingGrant") };
    const tool = this.options.registry.getTool(event.toolName);
    if (!tool || !isAgentToolAuthorized(toolAccessGrant, tool)) {
      return {
        block: true,
        reason: agentErrorMessage("tool.notRegisteredOrAllowed", { toolName: event.toolName }),
      };
    }
    if (!isAgentToolSupportedByPlanningMode(tool, this.options.toolPlanningMode)) {
      return {
        block: true,
        reason: agentErrorMessage("tool.planningModeUnavailable", { toolName: event.toolName }),
      };
    }
    if (!isAgentToolAvailableForInteraction(tool, context.interaction)) {
      return {
        block: true,
        reason: agentErrorMessage("tool.notRegisteredOrAllowed", { toolName: event.toolName }),
      };
    }
    if (
      options.requireExposure !== false &&
      isAgentToolDynamicallyDiscoverable(tool) &&
      context.toolExposure &&
      !context.toolExposure.exposes(event.toolName)
    ) {
      return {
        block: true,
        reason: agentErrorMessage("tool.notRegisteredOrAllowed", { toolName: event.toolName }),
      };
    }
    let invocation;
    try {
      invocation = resolveAgentToolInvocation(
        tool,
        event.input,
        projectSeneraProcessBackendsToToolTargets(this.options.executionCapabilities().processBackends),
      );
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
    const sessionId = context.sessionId ?? context.turnState?.context.sessionId;
    if (!sessionId) {
      return { block: true, reason: agentErrorMessage("toolAccess.missingSession") };
    }
    const requestId = context.requestId ?? context.turnState?.context.requestId ?? event.toolCallId;
    const step = context.step ?? context.turnState?.context.step ?? 1;
    try {
      const browserTarget = await inspectBrowserToolTarget(tool, invocation.arguments, approvalMode);
      const resourceAccess = await inspectAgentToolResourceAccess(
        tool,
        invocation.arguments,
        this.options.resourceCapabilities,
      );
      const decision = await this.options.permissionGate.authorize({
        approvalMode,
        sessionId,
        requestId,
        toolCallId: event.toolCallId,
        batchId: context.turnState?.toolBatchId(event.toolCallId),
        step,
        toolName: event.toolName,
        arguments: invocation.arguments,
        ...(browserTarget?.requiresApproval
          ? {
              mandatoryApproval: {
                scope: browserTarget.scope,
                reason:
                  browserTarget.kind === "local-file"
                    ? "允许受控浏览器打开此本地文件，并加载其所在目录及子目录中的页面资源。"
                    : `受控浏览器访问私有网络目标 ${browserTarget.url.host} 需要你的批准。`,
              },
            }
          : {}),
        executionPlan: invocation.executionPlan,
        resourceAccess,
        toolAccessGrant,
        tool: projectAgentToolSafetyMetadata(tool),
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
      if (
        browserTarget?.requiresApproval &&
        approvalMode !== AgentExecutionApprovalModes.FullAccess &&
        decision?.action === "allow" &&
        context.turnState?.toolBatchId(event.toolCallId)
      ) {
        context.turnState.registerBrowserTargetAuthorization(event.toolCallId, { scope: browserTarget.scope });
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

async function inspectBrowserToolTarget(
  tool: RegisteredTool,
  arguments_: Readonly<Record<string, unknown>>,
  approvalMode: NonNullable<AgentPiToolProjectionContext["approvalMode"]>,
) {
  if (
    !(tool.search?.Capabilities ?? []).some(
      (capability) => capability.Risk?.Permission === AgentBrowserNetworkPermissionId,
    ) ||
    typeof arguments_.url !== "string"
  ) {
    return undefined;
  }

  try {
    return await inspectAgentBrowserTarget(arguments_.url, {
      maxUrlLength: readBrowserUrlLimit(tool) ?? AgentBrowserMaximumUrlLength,
      fullAccess: approvalMode === AgentExecutionApprovalModes.FullAccess,
    });
  } catch (error) {
    if (error instanceof AgentWebUrlPolicyError) return undefined;
    throw error;
  }
}

function readBrowserUrlLimit(tool: RegisteredTool): number | undefined {
  const properties = tool.contract?.arguments?.jsonSchema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return undefined;
  const url = (properties as Record<string, unknown>).url;
  if (!url || typeof url !== "object" || Array.isArray(url)) return undefined;
  const maxLength = (url as Record<string, unknown>).maxLength;
  return typeof maxLength === "number" && Number.isInteger(maxLength) && maxLength > 0 ? maxLength : undefined;
}
