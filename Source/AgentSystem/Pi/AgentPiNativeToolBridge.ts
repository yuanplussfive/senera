import { z } from "zod";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { isAgentToolAuthorized, type AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { AgentPiToolExecutionBridge } from "./AgentPiToolExecutionBridge.js";
import type { AgentPiToolCallPreflightInput } from "./AgentPiToolCallPreflight.js";
import type { AgentPiToolDefinition, AgentPiToolProjectionContext } from "./AgentPiTypes.js";
import { projectAgentToolCapabilityArguments } from "../ToolSearch/AgentToolCapabilityArgumentProjection.js";
import type { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
import {
  isAgentToolDynamicallyDiscoverable,
  isAgentToolSupportedByPlanningMode,
} from "../ToolRuntime/AgentToolInvocationRouting.js";
import type { AgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { ToolExecutionTarget } from "../Types/AgentToolContractTypes.js";
import { projectAgentToolInvocationSchema } from "../ToolRuntime/AgentToolExecutionPlan.js";
import { validateToolContractValue } from "../ToolRuntime/AgentToolSignatureArgumentValidator.js";
import { AgentPiToolContractPreparationError } from "./AgentPiToolContractPreparation.js";

export const AgentPiNativeToolBridgeName = "ToolCall";

const AgentPiNativeToolBridgeArgumentsSchema = z
  .object({
    tool: z.string().trim().min(1),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();

export const AgentPiNativeToolBridgeParameterSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    tool: {
      type: "string",
      minLength: 1,
      description: "填入刚刚确认过的真实能力名称；不要猜测名称，也不要把这个内部协议名写进对用户的发言。",
    },
    arguments: {
      type: "object",
      additionalProperties: true,
      description:
        "按已提供的当前契约填写真实参数；参数只能放在这个 arguments 字段里，不要改成 parameters 或其它名称。不要把参数说明、协议字段或解释文字混进用户可见内容。",
    },
  },
  required: ["tool", "arguments"],
} as const);

export interface AgentPiNativeToolBridgeInvocation {
  readonly tool: RegisteredTool;
  readonly arguments: Record<string, unknown>;
}

export class AgentPiNativeToolBridge {
  constructor(
    private readonly registry: AgentExtensionRegistry,
    private readonly execution: AgentPiToolExecutionBridge,
    private readonly toolPlanningMode: AgentModelToolPlanningMode,
    private readonly availableExecutionTargets: () => readonly ToolExecutionTarget[],
  ) {
    if (registry.getTool(AgentPiNativeToolBridgeName)) {
      throw new Error(`${AgentPiNativeToolBridgeName} is reserved by the Pi native dynamic-tool protocol.`);
    }
  }

  definition(context: () => AgentPiToolProjectionContext): AgentPiToolDefinition {
    return {
      name: AgentPiNativeToolBridgeName,
      label: "执行已确认的能力",
      description: [
        "执行已有当前契约的 Dynamic 能力。ToolSearch 的 contracts、ToolDescribe 或本工具的准备反馈都可提供准确说明；已有说明可以复用。缺少说明时查阅 ToolDescribe。常驻 Bootstrap 工具已有原生 schema，必须直接调用，不能传入这里。",
        "如果某个 Dynamic 工具已经作为当前回合的原生工具提供，必须直接调用该工具，不要把它包装进这里。",
        "tool 填写已提供契约的 Dynamic 工具准确名称，arguments 严格符合对应参数契约。顶层字段名固定为 tool 与 arguments。若返回 not_started 和当前契约，按说明重新提交；原操作没有执行。",
        "这是内部执行协议。面向用户时，用自然语言说明正在处理的事情，不要提 ToolSearch、ToolDescribe、ToolCall、工具名或参数。",
        "底层授权、审批、资源边界、生命周期和结果协议保持不变。",
      ].join("\n\n"),
      parameters: AgentPiNativeToolBridgeParameterSchema,
      executionMode: "parallel",
      execute: (toolCallId, params, signal) => {
        const projectionContext = context();
        let invocation: AgentPiNativeToolBridgeInvocation;
        try {
          invocation = this.resolve(
            params,
            projectionContext.toolAccessGrant,
            projectionContext.reusableCapabilities,
            projectionContext.toolExposure,
          );
        } catch (error) {
          if (error instanceof AgentPiToolContractPreparationError)
            projectionContext.turnState?.registerToolContractReceipts(toolCallId, error.receipts);
          throw error;
        }
        return this.execution.execute({
          tool: invocation.tool,
          toolCallId,
          params: invocation.arguments,
          signal,
          context: projectionContext,
        });
      },
    };
  }

  projectPreflight(
    event: AgentPiToolCallPreflightInput,
    toolAccessGrant: AgentToolAccessGrant,
    reusableCapabilities?: AgentPiToolProjectionContext["reusableCapabilities"],
    toolExposure?: AgentToolExposureState,
  ): AgentPiToolCallPreflightInput {
    if (event.toolName !== AgentPiNativeToolBridgeName) return event;
    const invocation = this.resolve(event.input, toolAccessGrant, reusableCapabilities, toolExposure);
    return {
      ...event,
      toolName: invocation.tool.name,
      input: invocation.arguments,
    };
  }

  private resolve(
    value: unknown,
    toolAccessGrant: AgentToolAccessGrant | undefined,
    reusableCapabilities?: AgentPiToolProjectionContext["reusableCapabilities"],
    toolExposure?: AgentToolExposureState,
  ): AgentPiNativeToolBridgeInvocation {
    if (!toolAccessGrant) throw new AgentLocalizedError("toolAccess.missingGrant");
    const parsed = AgentPiNativeToolBridgeArgumentsSchema.safeParse(value);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "arguments"}: ${issue.message}`)
        .join("; ");
      throw new Error(`${AgentPiNativeToolBridgeName} arguments are invalid: ${issues}`);
    }

    const tool = this.registry.getTool(parsed.data.tool);
    if (!tool) {
      throw new AgentLocalizedError("tool.notRegisteredOrAllowed", { toolName: parsed.data.tool });
    }
    if (!isAgentToolDynamicallyDiscoverable(tool)) {
      throw new AgentLocalizedError("tool.bootstrapMustBeCalledDirectly", { toolName: tool.name });
    }
    if (!isAgentToolSupportedByPlanningMode(tool, this.toolPlanningMode)) {
      throw new AgentLocalizedError("tool.planningModeUnavailable", { toolName: tool.name });
    }
    if (!isAgentToolAuthorized(toolAccessGrant, tool)) {
      throw new AgentLocalizedError("tool.notRegisteredOrAllowed", { toolName: tool.name });
    }
    const args = projectAgentToolCapabilityArguments(tool, parsed.data.arguments, reusableCapabilities);
    const targets = this.availableExecutionTargets();
    const issues = tool.contract?.arguments
      ? validateToolContractValue({
          schema: projectAgentToolInvocationSchema(tool, tool.contract.arguments.jsonSchema, targets),
          value: args,
        })
      : [];
    const confirmed = toolExposure?.hasConfirmedContract(tool.name, tool.contract?.digest) === true;
    if (!confirmed || issues.length)
      throw new AgentPiToolContractPreparationError(
        tool,
        targets,
        issues.length ? "invalid_arguments" : "needs_contract",
        issues,
      );
    return {
      tool,
      arguments: args,
    };
  }
}

export function projectAgentPiNativeToolCallDisplay(input: {
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
}): { readonly toolName: string; readonly arguments: Record<string, unknown> } {
  if (input.toolName !== AgentPiNativeToolBridgeName) return input;
  const parsed = AgentPiNativeToolBridgeArgumentsSchema.safeParse(input.arguments);
  return parsed.success ? { toolName: parsed.data.tool, arguments: parsed.data.arguments } : input;
}
