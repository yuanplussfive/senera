import { z } from "zod";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { isAgentToolAuthorized, type AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import { ToolLoadingModes } from "../Types/AgentToolContractTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { AgentPiToolExecutionBridge } from "./AgentPiToolExecutionBridge.js";
import type { AgentPiToolCallPreflightInput } from "./AgentPiToolCallPreflight.js";
import type { AgentPiToolDefinition, AgentPiToolProjectionContext } from "./AgentPiTypes.js";

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
      description: "按对应能力的 ToolDescribe 契约填写真实参数；不要把参数说明、协议字段或解释文字混进用户可见内容。",
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
        "把已经确认过的外部能力交给运行时执行。先通过 ToolSearch 找到候选，再用 ToolDescribe 确认适用场景、参数和边界。",
        "tool 必须填写 ToolDescribe 返回的准确名称，arguments 必须严格符合对应的 TypeScript-like 参数契约。",
        "这是内部执行协议。面向用户时，用自然语言说明正在处理的事情，不要提 ToolSearch、ToolDescribe、ToolCall、工具名或参数。",
        "底层授权、审批、资源边界、生命周期和结果协议保持不变。",
      ].join("\n\n"),
      parameters: AgentPiNativeToolBridgeParameterSchema,
      executionMode: "parallel",
      execute: (toolCallId, params, signal) => {
        const projectionContext = context();
        const invocation = this.resolve(params, projectionContext.toolAccessGrant);
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
  ): AgentPiToolCallPreflightInput {
    if (event.toolName !== AgentPiNativeToolBridgeName) return event;
    const invocation = this.resolve(event.input, toolAccessGrant);
    return {
      ...event,
      toolName: invocation.tool.name,
      input: invocation.arguments,
    };
  }

  private resolve(
    value: unknown,
    toolAccessGrant: AgentToolAccessGrant | undefined,
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
    if (!tool || tool.loading !== ToolLoadingModes.Dynamic || !isAgentToolAuthorized(toolAccessGrant, tool.name)) {
      throw new AgentLocalizedError("tool.notRegisteredOrAllowed", { toolName: parsed.data.tool });
    }
    return {
      tool,
      arguments: parsed.data.arguments,
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
