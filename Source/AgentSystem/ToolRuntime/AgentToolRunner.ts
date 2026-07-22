import type { AgentToolProcessRunResult } from "./AgentToolProcessTypes.js";
import type { AgentToolHostCapabilityRegistry } from "./AgentToolHostCapabilityRegistry.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { AgentPluginRegistryLike } from "../Types/ToolRuntimeTypes.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { toolProcessFailureResult } from "./AgentToolProcessEnvelope.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { AgentMcpToolRunner } from "../Mcp/AgentMcpToolRunner.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { explainUnsupportedAgentToolRuntime } from "./AgentToolRuntimeCapabilities.js";
import { resolveAgentToolRuntimeCapabilities } from "./AgentToolRuntimeCapabilities.js";
import { AgentToolExecutionReporter } from "./AgentToolExecutionReporter.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import {
  createCompiledAgentMcpRuntimeModuleResolver,
  type AgentMcpRuntimeModuleResolver,
} from "../Mcp/AgentMcpRuntimeModuleResolver.js";
import { resolveArtifactsConfig } from "../AgentDefaults.js";
import { createSeneraOutputSpool, updateSeneraOutputSpoolState } from "../Execution/SeneraOutputSpool.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertInsideRoot } from "../Artifacts/AgentArtifactLocator.js";
import { validateToolSignatureArguments } from "./AgentToolSignatureArgumentValidator.js";
import {
  AgentToolExecutionTargetError,
  bindAgentToolInvocationToExecutionPlan,
  resolveAgentToolInvocation,
  type AgentToolExecutionPlan,
} from "./AgentToolExecutionPlan.js";

export interface AgentToolRunnerLike {
  run(
    tool: RegisteredTool,
    args: Record<string, unknown>,
    context?: AgentToolRunnerContext,
  ): Promise<AgentToolProcessRunResult>;
}

export interface AgentToolRunnerContext {
  sessionId?: string;
  requestId?: string;
  step?: number;
  toolCallId?: string;
  batchId?: string;
  configPath?: string;
  onEvent?: AgentEventSink;
  visibleToolNames?: readonly string[];
  signal?: AbortSignal;
  executionPlan?: AgentToolExecutionPlan;
}

export class AgentToolRunner implements AgentToolRunnerLike {
  private readonly mcpRunner: AgentMcpToolRunner;

  constructor(
    private readonly config: AgentSystemConfig,
    private readonly workspaceRoot: string,
    private readonly hostCapabilities: AgentToolHostCapabilityRegistry,
    private readonly registry: AgentPluginRegistryLike,
    private readonly executionEnv: SeneraExecutionEnv,
    runtimeModuleResolver: AgentMcpRuntimeModuleResolver = createCompiledAgentMcpRuntimeModuleResolver(process.cwd()),
    interactionInput?: AgentInteractionInputRuntime,
  ) {
    this.mcpRunner = new AgentMcpToolRunner({
      config,
      workspaceRoot,
      runtimeModuleResolver,
      executionEnv,
      interactionInput,
    });
  }

  close(): Promise<void> {
    return this.mcpRunner.close();
  }

  async run(
    tool: RegisteredTool,
    args: Record<string, unknown>,
    context: AgentToolRunnerContext = {},
  ): Promise<AgentToolProcessRunResult> {
    let invocation;
    try {
      invocation = context.executionPlan
        ? bindAgentToolInvocationToExecutionPlan(tool, args, context.executionPlan)
        : resolveAgentToolInvocation(tool, args);
    } catch (error) {
      if (error instanceof AgentToolExecutionTargetError) {
        return this.failure(
          error.message,
          {
            toolName: tool.name,
            executionTarget: error.value,
            availableTargets: error.availableTargets,
          },
          AgentExecutionErrorCodes.InvalidToolArguments,
        );
      }
      throw error;
    }
    const argumentContract = tool.contract?.arguments;
    if (argumentContract) {
      const issues = validateToolSignatureArguments({
        contract: argumentContract,
        args: invocation.arguments,
        path: [tool.name],
      });
      if (issues.length > 0) {
        return this.failure(
          `Invalid arguments for ${tool.name}.`,
          { toolName: tool.name, issues },
          AgentExecutionErrorCodes.InvalidToolArguments,
        );
      }
    }
    const unsupportedRuntime = explainUnsupportedAgentToolRuntime(tool);
    if (unsupportedRuntime.length > 0) {
      return this.failure(
        unsupportedRuntime.join(" "),
        {
          toolName: tool.name,
          handlerKind: tool.handler.kind,
          runtime: tool.runtime,
        },
        AgentExecutionErrorCodes.ToolProcessRuntimeUnsupported,
      );
    }
    const runtime = resolveAgentToolRuntimeCapabilities(tool);
    const outputSpool = runtime.outputStreaming
      ? await createPluginOutputSpool(this.config, this.workspaceRoot, {
          sessionId: context.sessionId,
          requestId: context.requestId,
          toolCallId: context.toolCallId,
        })
      : undefined;
    const reporter = new AgentToolExecutionReporter({
      toolName: tool.name,
      callId: context.toolCallId,
      requestId: context.requestId,
      step: context.step,
      batchId: context.batchId,
      onEvent: context.onEvent,
      outputSink: outputSpool,
      capabilities: runtime,
    });
    const runners = {
      HostCapability: () =>
        this.runHostCapability(
          tool,
          invocation.arguments,
          { ...context, executionPlan: invocation.executionPlan },
          reporter,
        ),
      McpTool: () =>
        this.mcpRunner.run(
          tool,
          invocation.arguments,
          { ...context, executionPlan: invocation.executionPlan },
          reporter,
        ),
    } satisfies Record<RegisteredTool["handler"]["kind"], () => Promise<AgentToolProcessRunResult>>;

    let result: AgentToolProcessRunResult | undefined;
    let executionFailure: unknown;
    try {
      try {
        result = await runners[tool.handler.kind]();
      } finally {
        await reporter.flush();
      }
    } catch (error) {
      executionFailure = error;
    }

    let spoolSealed = false;
    let spoolFailure: unknown;
    if (outputSpool) {
      try {
        await outputSpool.close();
        spoolSealed = true;
      } catch (error) {
        spoolFailure = error;
        try {
          await updateSeneraOutputSpoolState(outputSpool.descriptor, "failed");
        } catch (stateError) {
          spoolFailure = new AggregateError(
            [error, stateError],
            "Tool output spool could not be sealed or marked failed.",
          );
        }
      }
    }

    if (spoolFailure) {
      if (executionFailure) throw new AggregateError([executionFailure, spoolFailure], "Tool output capture failed.");
      throw spoolFailure;
    }
    if (executionFailure) {
      if (outputSpool && spoolSealed) await outputSpool.cleanup();
      throw executionFailure;
    }
    if (!result) throw new Error("Tool runner completed without a result.");
    if (outputSpool && !result.outputCapture) {
      return { ...result, outputCapture: outputSpool.descriptor };
    }
    if (outputSpool && spoolSealed) await outputSpool.cleanup();
    return result;
  }

  private async runHostCapability(
    tool: RegisteredTool,
    args: Record<string, unknown>,
    context: AgentToolRunnerContext,
    reporter: AgentToolExecutionReporter,
  ): Promise<AgentToolProcessRunResult> {
    if (tool.handler.kind !== "HostCapability") {
      return this.failure(agentErrorMessage("tool.notHostCapability", { toolName: tool.name }), {
        toolName: tool.name,
      });
    }

    const handler = this.hostCapabilities.get(tool.handler.capability);
    if (!handler) {
      return this.failure(
        agentErrorMessage("tool.hostCapabilityMissingHandler", {
          capability: tool.handler.capability,
        }),
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
      sessionId: context.sessionId,
      requestId: context.requestId,
      step: context.step,
      toolCallId: context.toolCallId,
      batchId: context.batchId,
      onEvent: context.onEvent,
      visibleToolNames: context.visibleToolNames,
      signal: context.signal,
      executionPlan: context.executionPlan,
      reporter,
    });
  }

  private failure(
    message: string,
    details: Record<string, unknown>,
    code: (typeof AgentExecutionErrorCodes)[keyof typeof AgentExecutionErrorCodes] = AgentExecutionErrorCodes.ToolProcessConfigurationInvalid,
  ): AgentToolProcessRunResult {
    return toolProcessFailureResult({
      code,
      message,
      details: {
        phase: AgentToolProcessErrorPhases.ConfigurationValidation,
        ...details,
      },
    });
  }
}

async function createPluginOutputSpool(
  config: AgentSystemConfig,
  workspaceRoot: string,
  metadata: { sessionId?: string; requestId?: string; toolCallId?: string },
) {
  const artifacts = resolveArtifactsConfig(config);
  const spoolRoot = assertInsideRoot(
    workspaceRoot,
    path.resolve(workspaceRoot, artifacts.RootDir, ".spool"),
    `artifact spool 根目录超出工作区：${artifacts.RootDir}`,
  );
  return createSeneraOutputSpool(spoolRoot, randomUUID(), {
    maxBytes: artifacts.OutputCaptureMaxBytes,
    metadata,
  });
}
