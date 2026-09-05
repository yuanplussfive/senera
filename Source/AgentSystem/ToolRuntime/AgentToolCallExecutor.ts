import { AgentWorkspaceChangeCapture } from "../Artifacts/AgentWorkspaceChangeCapture.js";
import { redactArtifactSecrets } from "../Artifacts/AgentArtifactRedaction.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { createToolCallId } from "../Core/AgentIds.js";
import { clampField } from "../Core/AgentStepTrace.js";
import { readAgentUnknownRecord as readRecord } from "../Core/AgentUnknownValue.js";
import { emitAgentEvent } from "../Events/AgentEvent.js";
import { SystemAgentLifecycleClock, type AgentLifecycleClock } from "../Events/AgentLifecycleClock.js";
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
import { projectAgentToolInteraction } from "./AgentToolInteractionProjector.js";
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
  SuspendChildRunControlResult,
} from "./AgentToolCallExecutionTypes.js";
import { projectAgentToolEventOrigin } from "./AgentToolEventOrigin.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import { projectSeneraProcessBackendsToToolTargets, resolveAgentToolInvocation } from "./AgentToolExecutionPlan.js";
import { isAgentToolAuthorized, type AgentToolAccessGrant } from "./AgentToolAccessGrant.js";
import type { AgentMcpToolsChangedHandler } from "../Mcp/AgentMcpToolCatalogChange.js";
import type { AgentMcpToolClientPool } from "../Mcp/AgentMcpToolClientPool.js";
import type { AgentMcpSamplingHandler } from "../Mcp/AgentMcpSamplingRuntime.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type { AgentResourceResolverLike } from "../Resources/AgentResourceResolver.js";
import { resourceAccessGrantMatchesBinding } from "../Execution/SeneraResourceAccess.js";
import type { AgentTodoService } from "../Todos/AgentTodoService.js";
import type { AgentContinuityIdentityContext } from "../Continuity/AgentContinuityIdentityStore.js";
import type { AgentIdentityTemplateValues } from "../Prompt/AgentIdentityTemplate.js";

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
  resourceResolver?: AgentResourceResolverLike;
  todoService?: AgentTodoService;
  continuityIdentity?: AgentContinuityIdentityContext;
  identityTemplateValues?: () => AgentIdentityTemplateValues;
  clock?: AgentLifecycleClock;
}

interface AgentToolLifecycleIdentity {
  readonly requestId: string;
  readonly step: number;
}

interface AgentToolLifecycleTiming {
  readonly startedAt: string;
  readonly durationMs: number;
}

export class AgentToolCallExecutor {
  private readonly events = new AgentLoopEventFactory();
  private readonly toolRunner: AgentToolRunnerLike;
  private readonly ownedToolRunner?: AgentToolRunner;
  private readonly workspaceCapture: AgentWorkspaceChangeCapture;
  private readonly emitLifecycleEvents: boolean;
  private readonly hostCapabilities: AgentToolHostCapabilityRegistry;
  private readonly executionEnv: SeneraExecutionEnv;
  private readonly clock: AgentLifecycleClock;
  private closePromise: Promise<void> | undefined;

  constructor(private readonly options: AgentToolCallExecutorOptions) {
    const workspaceRoot = options.workspaceRoot ?? process.cwd();
    const executionEnv =
      options.executionEnv ??
      new SeneraLocalExecutionEnv({
        workspaceRoot,
      });
    this.executionEnv = executionEnv;
    this.emitLifecycleEvents = options.emitLifecycleEvents ?? true;
    this.clock = options.clock ?? SystemAgentLifecycleClock;
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
        options.resourceResolver,
        options.todoService,
        options.continuityIdentity,
        options.identityTemplateValues,
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
    const suspension = readSuspendChildRunControl(result.result);

    return control
      ? {
          kind: "AskUser",
          value: control,
        }
      : suspension
        ? {
            kind: "SuspendChildRun",
            value: suspension,
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
    const invocation = resolveAgentToolInvocation(
      tool,
      requestedArguments,
      projectSeneraProcessBackendsToToolTargets(this.executionEnv.capabilities.processBackends),
    );
    const args = invocation.arguments;
    const origin = projectAgentToolEventOrigin(tool);
    const purpose = projectAgentToolInteraction(tool).purpose;
    if (
      context.resourceAccessGrant &&
      !resourceAccessGrantMatchesBinding(context.resourceAccessGrant, {
        sessionId: context.sessionId,
        requestId: context.requestId,
        toolCallId: callId,
        toolName: tool.name,
      })
    ) {
      throw new Error(`Resource access grant does not belong to tool call ${callId}.`);
    }
    const capture = await this.workspaceCapture.prepare({
      policy: tool.artifactPolicy,
      args,
    });
    const startedAtEpoch = this.clock.now();
    const startedAtMonotonic = this.clock.monotonicNow();
    const startedAt = this.clock.timestamp(startedAtEpoch);

    if (!context.batchId) {
      await this.emitLifecycle(context, ({ requestId, step }) =>
        this.events.toolCallsPlanned(requestId, step, [tool.name]),
      );
    }
    await this.emitLifecycle(context, ({ requestId, step }) =>
      this.events.toolCallStarted(requestId, step, index, tool.name, callId, {
        arguments: clampField(redactArtifactSecrets(args, tool.artifactPolicy)),
        purpose,
        origin,
        batchId: context.batchId,
        startedAt,
      }),
    );

    let terminalLifecycleAttempted = false;
    try {
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
          visibleToolNames:
            context.toolExposure?.snapshot().exposedToolNames ?? context.toolAccessGrant.exposedToolNames,
          authorizedToolNames: context.toolAccessGrant.authorizedToolNames,
          toolExposure: context.toolExposure,
          signal: context.signal,
          executionPlan: invocation.executionPlan,
          tokenBudget: context.tokenBudget,
          approvalMode: context.approvalMode,
          activeSkills: context.activeSkills,
          thinkingLevel: context.thinkingLevel,
          resourceAccessGrant: context.resourceAccessGrant,
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
        origin,
        arguments: args,
        execution: invocation.executionPlan,
        process,
        artifactPayload: execution.artifactPayload,
        outputCapture: execution.outputCapture,
        semanticProjectionRequest: execution.semanticProjectionRequest,
        result,
        outcome,
        artifactPolicy: tool.artifactPolicy,
        workspaceCapture,
      };
      const executed: ExecutedToolCallResult = {
        ...executedBase,
        presentation: projectAgentToolResultPresentation(executedBase),
      };

      terminalLifecycleAttempted = true;
      await this.emitResultLifecycle(
        context,
        index,
        executed,
        {
          startedAt,
          durationMs: this.elapsedDuration(startedAtMonotonic),
        },
        origin,
        purpose,
      );
      return executed;
    } catch (error) {
      if (!terminalLifecycleAttempted) {
        await this.emitFailureLifecycle(
          context,
          index,
          tool.name,
          callId,
          error,
          {
            startedAt,
            durationMs: this.elapsedDuration(startedAtMonotonic),
          },
          origin,
          purpose,
        );
      }
      throw error;
    }
  }

  private async emitResultLifecycle(
    context: AgentToolCallExecutionContext,
    index: number,
    result: ExecutedToolCallResult,
    timing: AgentToolLifecycleTiming,
    origin: ReturnType<typeof projectAgentToolEventOrigin>,
    purpose: string,
  ): Promise<void> {
    const error = readAgentToolFailure(result.outcome);
    const presentation = result.presentation ?? projectAgentToolResultPresentation(result);
    const lifecycleEmitted = await this.emitLifecycle(context, ({ requestId, step }) =>
      error
        ? this.events.toolCallFailed(requestId, step, index, result.name, result.callId, error.message, error.code, {
            purpose,
            origin,
            batchId: context.batchId,
            ...timing,
          })
        : this.events.toolCallCompleted(requestId, step, index, result.name, result.callId, presentation, {
            purpose,
            origin,
            batchId: context.batchId,
            ...timing,
          }),
    );
    if (lifecycleEmitted) context.onLifecycleSettled?.(error ? "failed" : "completed");
    if (!context.deferResultDetail) {
      await this.emitLifecycle(context, ({ requestId, step }) =>
        this.events.toolCallResultDetail(requestId, step, index, result.name, result.callId, result.result, {
          origin,
          batchId: context.batchId,
          presentation,
        }),
      );
    }
  }

  private async emitFailureLifecycle(
    context: AgentToolCallExecutionContext,
    index: number,
    toolName: string,
    callId: string,
    error: unknown,
    timing: AgentToolLifecycleTiming,
    origin: ReturnType<typeof projectAgentToolEventOrigin>,
    purpose: string,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const lifecycleEmitted = await this.emitLifecycle(context, ({ requestId, step }) =>
      this.events.toolCallFailed(requestId, step, index, toolName, callId, message, undefined, {
        purpose,
        origin,
        batchId: context.batchId,
        ...timing,
      }),
    );
    if (lifecycleEmitted) context.onLifecycleSettled?.("failed");
  }

  private elapsedDuration(startedAtMonotonic: number): number {
    return Math.max(0, Math.round(this.clock.monotonicNow() - startedAtMonotonic));
  }

  private async emitLifecycle(
    context: AgentToolCallExecutionContext,
    create: (identity: AgentToolLifecycleIdentity) => Parameters<typeof emitAgentEvent>[1],
  ): Promise<boolean> {
    const identity = readToolLifecycleIdentity(context);
    if (!this.emitLifecycleEvents || !identity) return false;

    await emitAgentEvent(context.onEvent, create(identity));
    return true;
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

function readSuspendChildRunControl(value: unknown): SuspendChildRunControlResult | undefined {
  const record = readRecord(readRecord(value)?.control);
  if (record?.kind !== "SuspendChildRun") return undefined;
  return {
    childRunId: readRequiredText(record, "childRunId", "Child-run suspension is missing childRunId."),
    messageId: readRequiredText(record, "messageId", "Child-run suspension is missing messageId."),
    message: readRequiredText(record, "message", "Child-run suspension is missing message."),
  };
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
