import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import { AgentToolProcessRunner } from "./AgentToolProcessRunner.js";
import type { AgentToolHostCapabilityRegistry } from "./AgentToolHostCapabilityRegistry.js";
import type {
  AgentSystemConfig,
  AgentPluginRegistryLike,
  RegisteredTool,
} from "./Types.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "./AgentXmlStatus.js";
import { AgentToolProcessProtocol } from "./AgentToolProcessProtocol.js";
import type { AgentXmlProtocolSpec } from "./AgentXmlPolicy.js";

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
  visibleToolNames?: readonly string[];
  signal?: AbortSignal;
}

export class AgentToolRunner implements AgentToolRunnerLike {
  private readonly processRunner: AgentToolProcessRunner;

  constructor(
    private readonly config: AgentSystemConfig,
    protocol: AgentXmlProtocolSpec,
    private readonly workspaceRoot: string,
    private readonly hostCapabilities: AgentToolHostCapabilityRegistry,
    private readonly registry: AgentPluginRegistryLike,
    processRunner?: AgentToolProcessRunner,
  ) {
    this.processRunner = processRunner ?? new AgentToolProcessRunner(config, protocol, workspaceRoot);
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
      workspaceRoot: this.workspaceRoot,
      registry: this.registry,
      requestId: context.requestId,
      step: context.step,
      visibleToolNames: context.visibleToolNames,
      signal: context.signal,
    });
  }

  private failure(
    message: string,
    details: Record<string, unknown>,
  ): AgentToolProcessRunResult {
    return {
      response: {
        protocol: AgentToolProcessProtocol,
        ok: false,
        error: {
          code: AgentExecutionErrorCodes.ToolProcessConfigurationInvalid,
          message,
          details: {
            phase: AgentToolProcessErrorPhases.ConfigurationValidation,
            ...details,
          },
        },
      },
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
    };
  }
}
