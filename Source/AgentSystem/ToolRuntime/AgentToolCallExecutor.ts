import { AgentWorkspaceChangeCapture } from "../Artifacts/AgentWorkspaceChangeCapture.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { createToolCallId } from "../Core/AgentIds.js";
import { readAgentUnknownRecord as readRecord } from "../Core/AgentUnknownValue.js";
import { emitAgentEvent } from "../Events/AgentEvent.js";
import { AgentLoopEventFactory } from "../Loop/AgentLoopEventFactory.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { createDefaultHostCapabilityRegistry } from "../AgentDefaultHostCapabilities.js";
import type { AgentToolHostCapabilityRegistry } from "./AgentToolHostCapabilityRegistry.js";
import { AgentToolRunner, type AgentToolRunnerLike } from "./AgentToolRunner.js";
import type { AgentToolSearchRuntime } from "../ToolSearch/AgentToolSearchRuntime.js";
import type { AgentXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import { SeneraLocalExecutionEnv } from "../Execution/SeneraLocalExecutionEnv.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { projectAgentToolResultPresentation } from "./AgentToolResultPresentation.js";
import {
  AgentToolFailureSources,
  createAgentToolExecutionOutcome,
  normalizeAgentToolProcessResult,
  readAgentToolFailure,
} from "./AgentToolResultOutcome.js";
import type {
  AgentToolCallExecutionContext,
  AgentToolCallExecutionRequest,
  AgentToolCallExecutionResult,
  AskUserControlResult,
} from "./AgentToolCallExecutionTypes.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import { resolveAgentToolInvocation } from "./AgentToolExecutionPlan.js";
import { isAgentToolAuthorized, type AgentToolAccessGrant } from "./AgentToolAccessGrant.js";
import type { AgentMcpToolsChangedHandler } from "../Mcp/AgentMcpToolCatalogChange.js";
import type { AgentMcpToolClientPool } from "../Mcp/AgentMcpToolClientPool.js";
import type { AgentMcpSamplingHandler } from "../Mcp/AgentMcpSamplingRuntime.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";

export interface AgentToolCallExecutorOptions {
  registry: AgentExtensionRegistry;
  config: AgentSystemConfig;
  protocol: AgentXmlProtocolSpec;
  toolRunner?: AgentToolRunnerLike;
  workspaceRoot?: string;
  hostCapabilities?: AgentToolHostCapabilityRegistry;
  toolSearch?: AgentToolSearchRuntime;
  executionResources?: AgentExecutionResourceBroker;
  executionEnv?: SeneraExecutionEnv;
  configPath?: string;
  emitLifecycleEvents?: boolean;
  interactionInput?: AgentInteractionInputRuntime;
  modelProviderId?: string;
  onMcpToolsChanged?: AgentMcpToolsChangedHandler;
  mcpClientPool?: AgentMcpToolClientPool;
  mcpSampling?: AgentMcpSamplingHandler;
  uploadStore?: AgentUploadStore;
}

interface AgentToolLifecycleIdentity {
  readonly requestId: string;
  readonly step: number;
}

export class AgentToolCallExecutor {
  private readonly events = new AgentLoopEventFactory();
  private readonly toolRunner: AgentToolRunnerLike;
  private readonly ownedToolRunner?: AgentToolRunner;
  private readonly workspaceCapture: AgentWorkspaceChangeCapture;
  private readonly emitLifecycleEvents: boolean;
  private readonly hostCapabilities: AgentToolHostCapabilityRegistry;
  private closePromise: Promise<void> | undefined;

  constructor(private readonly options: AgentToolCallExecutorOptions) {
    const workspaceRoot = options.workspaceRoot ?? process.cwd();
    const executionEnv =
      options.executionEnv ??
      new SeneraLocalExecutionEnv({
        workspaceRoot,
      });
    this.emitLifecycleEvents = options.emitLifecycleEvents ?? true;
    this.workspaceCapture = new AgentWorkspaceChangeCapture({
      workspaceRoot,
    });
    this.hostCapabilities =
      options.hostCapabilities ??
      createDefaultHostCapabilityRegistry({
        toolSearch: options.toolSearch,
        executionResources: options.executionResources,
      });
    if (options.toolRunner) {
      this.ownedToolRunner = undefined;
      this.toolRunner = options.toolRunner;
    } else {
      const ownedToolRunner = new AgentToolRunner(
        options.config,
        workspaceRoot,
        this.hostCapabilities,
        options.registry,
        executionEnv,
        options.interactionInput,
        options.modelProviderId,
        options.onMcpToolsChanged,
        options.mcpClientPool,
        options.mcpSampling,
        options.uploadStore,
      );
      this.ownedToolRunner = ownedToolRunner;
      this.toolRunner = ownedToolRunner;
    }
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.ownedToolRunner?.close() ?? Promise.resolve());
  }

  projectToolInvocationSchema(
    tool: RegisteredTool,
    schema: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    return this.hostCapabilities.projectInvocationSchema(tool, schema);
  }

  projectToolDescription(tool: RegisteredTool, description: string): string {
    return this.hostCapabilities.projectDescription(tool, description);
  }

  async execute(
    request: AgentToolCallExecutionRequest,
    context: AgentToolCallExecutionContext,
  ): Promise<AgentToolCallExecutionResult> {
    const tool = this.resolveTool(request, context.toolAccessGrant);
    const result = await this.runToolCall(tool, request, context);
    const control = readAskUserControl(result.result);

    return control
      ? {
          kind: "AskUser",
          value: control,
        }
      : {
          kind: "ToolResults",
          value: [result],
        };
  }

  private resolveTool(request: AgentToolCallExecutionRequest, toolAccessGrant: AgentToolAccessGrant): RegisteredTool {
    const tool = this.options.registry.getTool(request.name);
    if (!tool || !isAgentToolAuthorized(toolAccessGrant, request.name)) {
      throw new AgentLocalizedError("tool.notRegisteredOrAllowed", { toolName: request.name });
    }
    if (
      request.expectedContractDigest !== undefined &&
      (tool.contract?.digest ?? null) !== request.expectedContractDigest
    ) {
      throw new AgentLocalizedError("tool.catalogRevisionChanged", { toolName: request.name });
    }

    return tool;
  }

  private async runToolCall(
    tool: RegisteredTool,
    request: AgentToolCallExecutionRequest,
    context: AgentToolCallExecutionContext,
  ): Promise<ExecutedToolCallResult> {
    throwIfAborted(context.signal);
    const callId = request.callId ?? createToolCallId();
    const index = request.index ?? 0;
    const requestedArguments = request.arguments ?? {};
    const invocation = resolveAgentToolInvocation(tool, requestedArguments);
    const args = invocation.arguments;
    const capture = await this.workspaceCapture.prepare({
      policy: tool.artifactPolicy,
      args,
    });

    if (!context.batchId) {
      await this.emitLifecycle(context, ({ requestId, step }) =>
        this.events.toolCallsPlanned(requestId, step, [tool.name]),
      );
    }
    await this.emitLifecycle(context, ({ requestId, step }) =>
      this.events.toolCallStarted(requestId, step, index, tool.name, callId, {
        batchId: context.batchId,
      }),
    );

    throwIfAborted(context.signal);
    const execution = normalizeAgentToolProcessResult(
      await this.toolRunner.run(tool, args, {
        sessionId: context.sessionId,
        requestId: context.requestId,
        step: context.step,
        toolCallId: callId,
        batchId: context.batchId,
        configPath: this.options.configPath,
        onEvent: context.onEvent,
        visibleToolNames: context.toolExposure?.snapshot().exposedToolNames ?? context.toolAccessGrant.exposedToolNames,
        toolExposure: context.toolExposure,
        signal: context.signal,
        executionPlan: invocation.executionPlan,
        tokenBudget: context.tokenBudget,
      }),
      tool.runtime.ResultAssessment,
    );
    throwIfAborted(context.signal);

    const responseError = execution.response.ok ? undefined : execution.response.error;
    const result = execution.response.ok ? execution.response.result : { error: responseError };
    const outcome = createAgentToolExecutionOutcome(
      execution,
      ToolFailureSourceByHandler[tool.handler.kind],
      tool.runtime.ResultAssessment,
    );
    const process = {
      exitCode: execution.exitCode,
      signal: execution.signal,
      stdout: execution.stdout,
      stderr: execution.stderr,
    };
    const workspaceCapture = await capture.complete(result);
    const executedBase: ExecutedToolCallResult = {
      callId,
      name: tool.name,
      arguments: requestedArguments,
      execution: invocation.executionPlan,
      process,
      outputCapture: execution.outputCapture,
      result,
      outcome,
      artifactPolicy: tool.artifactPolicy,
      workspaceCapture,
    };
    const executed: ExecutedToolCallResult = {
      ...executedBase,
      presentation: projectAgentToolResultPresentation(executedBase),
    };

    await this.emitResultLifecycle(context, index, executed);
    return executed;
  }

  private async emitResultLifecycle(
    context: AgentToolCallExecutionContext,
    index: number,
    result: ExecutedToolCallResult,
  ): Promise<void> {
    const error = readAgentToolFailure(result.outcome);
    await this.emitLifecycle(context, ({ requestId, step }) =>
      error
        ? this.events.toolCallFailed(requestId, step, index, result.name, result.callId, error.message, error.code, {
            batchId: context.batchId,
          })
        : this.events.toolCallCompleted(
            requestId,
            step,
            index,
            result.name,
            result.callId,
            result.presentation ?? projectAgentToolResultPresentation(result),
            { batchId: context.batchId },
          ),
    );
    await this.emitLifecycle(context, ({ requestId, step }) =>
      this.events.toolCallResultDetail(requestId, step, index, result.name, result.callId, result, {
        batchId: context.batchId,
      }),
    );
  }

  private async emitLifecycle(
    context: AgentToolCallExecutionContext,
    create: (identity: AgentToolLifecycleIdentity) => Parameters<typeof emitAgentEvent>[1],
  ): Promise<void> {
    const identity = readToolLifecycleIdentity(context);
    if (!this.emitLifecycleEvents || !identity) return;

    await emitAgentEvent(context.onEvent, create(identity));
  }
}

const ToolFailureSourceByHandler = {
  HostCapability: AgentToolFailureSources.Host,
  McpTool: AgentToolFailureSources.Mcp,
} as const satisfies Record<
  RegisteredTool["handler"]["kind"],
  (typeof AgentToolFailureSources)[keyof typeof AgentToolFailureSources]
>;

function readToolLifecycleIdentity(context: AgentToolCallExecutionContext): AgentToolLifecycleIdentity | undefined {
  return context.requestId && context.step !== undefined
    ? { requestId: context.requestId, step: context.step }
    : undefined;
}

function readAskUserControl(value: unknown): AskUserControlResult | undefined {
  const control = readRecord(value)?.control;
  const record = readRecord(control);
  if (record?.kind !== "AskUser") {
    return undefined;
  }

  const question = readRequiredText(record, "question", agentErrorMessage("tool.askUserControlMissingQuestion"));
  const reason = readOptionalText(record, "reason_code");
  return reason
    ? {
        question,
        reason_code: reason,
      }
    : { question };
}

function readRequiredText(value: Record<string, unknown>, key: string, message: string): string {
  const text = readOptionalText(value, key);
  if (!text) {
    throw new Error(message);
  }

  return text;
}

function readOptionalText(value: Record<string, unknown>, key: string): string | undefined {
  const text = typeof value[key] === "string" ? value[key].trim() : "";
  return text.length > 0 ? text : undefined;
}
