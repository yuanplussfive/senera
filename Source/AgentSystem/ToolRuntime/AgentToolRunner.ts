import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import { AgentToolProcessRunner } from "./AgentToolProcessRunner.js";
import type { AgentToolHostCapabilityRegistry } from "./AgentToolHostCapabilityRegistry.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { AgentPluginRegistryLike } from "../Types/ToolRuntimeTypes.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "../Xml/AgentXmlStatus.js";
import { toolProcessFailureResult } from "./AgentToolProcessEnvelope.js";
import type { AgentXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { AgentMcpToolRunner } from "../Mcp/AgentMcpToolRunner.js";

export interface AgentToolRunnerLike {
  run(
    tool: RegisteredTool,
    args: Record<string, unknown>,
    context?: AgentToolRunnerContext,
  ): Promise<AgentToolProcessRunResult>;
}

export interface AgentToolRunnerContext {
  requestId?: string;
  step?: number;
  configPath?: string;
  onEvent?: AgentEventSink;
  visibleToolNames?: readonly string[];
  signal?: AbortSignal;
}

export class AgentToolRunner implements AgentToolRunnerLike {
  private readonly processRunner: AgentToolProcessRunner;
  private readonly mcpRunner: AgentMcpToolRunner;

  constructor(
    private readonly config: AgentSystemConfig,
    protocol: AgentXmlProtocolSpec,
    private readonly workspaceRoot: string,
    private readonly hostCapabilities: AgentToolHostCapabilityRegistry,
    private readonly registry: AgentPluginRegistryLike,
    private readonly executionEnv: SeneraExecutionEnv,
    processRunner?: AgentToolProcessRunner,
  ) {
    this.processRunner = processRunner ?? new AgentToolProcessRunner(
      config,
      protocol,
      workspaceRoot,
      executionEnv.spawnProcess,
    );
    this.mcpRunner = new AgentMcpToolRunner({
      config,
      workspaceRoot,
      executionEnv,
    });
  }

  async run(
    tool: RegisteredTool,
    args: Record<string, unknown>,
    context: AgentToolRunnerContext = {},
  ): Promise<AgentToolProcessRunResult> {
    const runners = {
      PluginProcess: () => this.processRunner.run(tool, args, {
        signal: context.signal,
      }),
      HostCapability: () => this.runHostCapability(tool, args, context),
      McpTool: () => this.mcpRunner.run(tool, args, context),
    } satisfies Record<RegisteredTool["handler"]["kind"], () => Promise<AgentToolProcessRunResult>>;

    return runners[tool.handler.kind]();
  }

  private async runHostCapability(
    tool: RegisteredTool,
    args: Record<string, unknown>,
    context: AgentToolRunnerContext,
  ): Promise<AgentToolProcessRunResult> {
    if (tool.handler.kind !== "HostCapability") {
      return this.failure(
        `工具不是宿主能力：${tool.name}`,
        {
          toolName: tool.name,
        },
      );
    }

    const handler = this.hostCapabilities.get(tool.handler.capability);
    if (!handler) {
      return this.failure(
        `宿主能力没有注册：${tool.handler.capability}`,
        {
          toolName: tool.name,
          capability: tool.handler.capability,
        },
      );
    }

    return handler(args, {
      tool,
      config: this.config,
      configPath: context.configPath,
      workspaceRoot: this.workspaceRoot,
      registry: this.registry,
      executionEnv: this.executionEnv,
      requestId: context.requestId,
      step: context.step,
      onEvent: context.onEvent,
      visibleToolNames: context.visibleToolNames,
      signal: context.signal,
    });
  }

  private failure(
    message: string,
    details: Record<string, unknown>,
  ): AgentToolProcessRunResult {
    return toolProcessFailureResult({
      code: AgentExecutionErrorCodes.ToolProcessConfigurationInvalid,
      message,
      details: {
        phase: AgentToolProcessErrorPhases.ConfigurationValidation,
        ...details,
      },
    });
  }
}
