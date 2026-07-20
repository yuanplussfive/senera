import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTaskStore } from "@modelcontextprotocol/sdk/experimental/tasks";
import type { RequestOptions, RequestTaskStore } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolResultSchema,
  ElicitationCompleteNotificationSchema,
  ElicitRequestSchema,
  ErrorCode,
  McpError,
  UrlElicitationRequiredError,
  type ElicitRequestURLParams,
  type ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import { AgentCancellationError, readAbortMessage } from "../Core/AgentCancellation.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import type { SeneraPersistentProcessSpawner } from "../Execution/SeneraPersistentProcessTypes.js";
import { AgentMcpStdioTransport } from "./AgentMcpStdioTransport.js";
import type { ResolvedMcpServerManifest } from "./AgentMcpManifestResolver.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentMcpToolOutputNotificationSchema, type AgentMcpToolOutput } from "./AgentMcpToolOutputProtocol.js";
import {
  AgentMcpTaskEventNotificationSchema,
  AgentMcpTaskEventsReadResultSchema,
  supportsAgentMcpTaskEvents,
  type AgentMcpTaskEvent,
} from "./AgentMcpTaskEventProtocol.js";
import {
  TaskEventCapabilityName,
  TaskEventPageLimit,
  TaskEventProtocolVersion,
  TaskEventsReadMethod,
} from "@senera/tool-plugin-sdk/protocol";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import type {
  AgentInteractionInputOwner,
  AgentInteractionInputSchema,
} from "../Interaction/AgentInteractionInputTypes.js";
import { AgentInteractionInputModes } from "../Interaction/AgentInteractionInputTypes.js";

export interface AgentMcpToolProgress {
  progress: number;
  total?: number;
  message?: string;
}

export interface AgentMcpToolCallCorrelation {
  sessionId?: string;
  requestId?: string;
  step?: number;
  toolCallId?: string;
  batchId?: string;
}

export interface AgentMcpToolCallOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AgentMcpToolProgress) => void;
  onOutput?: (output: AgentMcpToolOutputEvent) => void;
  task?: boolean;
  onTask?: (task: AgentMcpToolTask) => void;
  correlation?: AgentMcpToolCallCorrelation;
  resumableEvents?: boolean;
  taskEventCursor?: AgentMcpTaskEventCursor;
  interactionOwner?: AgentInteractionInputOwner;
  interactionEventSink?: AgentEventSink;
}

export type AgentMcpToolOutputEvent = Omit<AgentMcpToolOutput, "outputToken">;

export interface AgentMcpTaskEventCursor {
  value: number;
}

export interface AgentMcpToolTask {
  taskId: string;
  status: "working" | "input_required" | "completed" | "failed" | "cancelled";
  statusMessage?: string;
  pollInterval?: number;
  terminal: boolean;
}

export interface AgentMcpToolClientOptions {
  server: ResolvedMcpServerManifest;
  requestTimeoutMs: number;
  spawnPersistentProcess: SeneraPersistentProcessSpawner;
  executionProfile: SeneraProcessExecutionProfile;
  terminationGraceMs: number;
  maxFrameBytes?: number;
  maxStderrBytes?: number;
  signal?: AbortSignal;
  interactionInput?: AgentInteractionInputRuntime;
}

export class AgentMcpTaskDetachedError extends Error {
  constructor(
    readonly toolName: string,
    readonly taskId: string,
    options?: ErrorOptions,
  ) {
    super(`MCP task ${taskId} for ${toolName} detached from its client connection.`, options);
    this.name = "AgentMcpTaskDetachedError";
  }
}

export class AgentMcpTaskCancelledError extends Error {
  constructor(readonly taskId: string) {
    super(`MCP task ${taskId} was cancelled.`);
    this.name = "AgentMcpTaskCancelledError";
  }
}

export class AgentMcpTaskInputRequiredError extends Error {
  constructor(readonly taskId: string) {
    super(`MCP task ${taskId} requires interactive input, but this tool did not declare elicitation support.`);
    this.name = "AgentMcpTaskInputRequiredError";
  }
}

export class AgentMcpTaskEventCapabilityError extends Error {
  constructor(readonly serverId: string) {
    super(`MCP server ${serverId} does not support ${TaskEventCapabilityName} version ${TaskEventProtocolVersion}.`);
    this.name = "AgentMcpTaskEventCapabilityError";
  }
}

export class AgentMcpUrlElicitationDeclinedError extends Error {
  constructor(
    readonly elicitationId: string,
    readonly action: "decline" | "cancel",
  ) {
    super(`MCP URL elicitation ${elicitationId} was ${action === "decline" ? "declined" : "cancelled"}.`);
    this.name = "AgentMcpUrlElicitationDeclinedError";
  }
}

export class AgentMcpTaskEventGapError extends Error {
  constructor(
    readonly taskId: string,
    readonly deliveredCursor: number,
    readonly pageCursor: number,
  ) {
    super(`MCP task ${taskId} event replay has a gap after cursor ${deliveredCursor}; page ended at ${pageCursor}.`);
    this.name = "AgentMcpTaskEventGapError";
  }
}

export async function withAgentMcpToolClient<TValue>(
  options: AgentMcpToolClientOptions,
  operation: (client: AgentMcpToolClient) => Promise<TValue>,
): Promise<TValue> {
  const toolClient = await openAgentMcpToolClient(options);
  try {
    return await operation(toolClient);
  } finally {
    await toolClient.close();
  }
}

export async function openAgentMcpToolClient(options: AgentMcpToolClientOptions): Promise<AgentMcpToolClient> {
  const transport = new AgentMcpStdioTransport({
    command: options.server.command,
    args: options.server.args,
    cwd: options.server.cwd,
    env: options.server.env,
    signal: options.signal,
    profile: options.executionProfile,
    spawnPersistentProcess: options.spawnPersistentProcess,
    terminationGraceMs: options.terminationGraceMs,
    maxFrameBytes: options.maxFrameBytes,
    maxStderrBytes: options.maxStderrBytes,
  });
  const clientTaskStore = options.interactionInput ? new InMemoryTaskStore() : undefined;
  const client = new Client(
    {
      name: "senera-mcp-tool-client",
      version: "0.1.0",
    },
    {
      capabilities: {
        ...(options.interactionInput ? { elicitation: { form: {}, url: {} } } : {}),
        ...(clientTaskStore
          ? {
              tasks: {
                requests: {
                  elicitation: { create: {} },
                },
              },
            }
          : {}),
        experimental: {
          [TaskEventCapabilityName]: { version: TaskEventProtocolVersion },
        },
      },
      taskStore: clientTaskStore,
      enforceStrictCapabilities: true,
    },
  );
  const toolClient = new AgentMcpToolClient(client, options, clientTaskStore);
  await client.connect(transport, mcpRequestOptions(options));
  return toolClient;
}

export class AgentMcpToolClient {
  private _closed = false;
  private readonly externalInteractionNamespace = createOpaqueId("mcp_elicitation_scope");
  private clientTaskStoreDisposed = false;
  private readonly outputHandlers = new Map<string, NonNullable<AgentMcpToolCallOptions["onOutput"]>>();
  private readonly taskEventHandlers = new Map<string, AgentMcpTaskEventDeliveryState>();
  private readonly interactionLease = new AgentKeyedLeaseQueue<"elicitation">();
  private activeInteraction:
    { owner: AgentInteractionInputOwner; signal?: AbortSignal; onEvent?: AgentEventSink } | undefined;

  constructor(
    private readonly client: Client,
    private readonly options: AgentMcpToolClientOptions,
    private readonly clientTaskStore?: Pick<InMemoryTaskStore, "cleanup">,
  ) {
    client.onclose = () => {
      this._closed = true;
      this.disposeClientTaskStore();
    };
    client.setNotificationHandler(AgentMcpToolOutputNotificationSchema, (notification) => {
      const output = notification.params;
      this.outputHandlers.get(output.outputToken)?.(output);
    });
    client.setNotificationHandler(AgentMcpTaskEventNotificationSchema, (notification) => {
      const { event, outputToken, progressToken } = notification.params;
      const state = this.readTaskEventState(outputToken, progressToken);
      if (state) deliverAgentMcpTaskEvent(state, event);
    });
    const interactionInput = options.interactionInput;
    if (interactionInput) {
      client.setNotificationHandler(ElicitationCompleteNotificationSchema, (notification) => {
        void interactionInput
          .completeExternal(this.externalInteractionId(notification.params.elicitationId))
          .catch((error) => reportMcpBackgroundError(client, error));
      });
      client.setRequestHandler(ElicitRequestSchema, async (request, extra) => {
        const params = request.params;
        const interaction = this.activeInteraction;
        if (!interaction) {
          throw new McpError(ErrorCode.InvalidRequest, "MCP elicitation has no active Senera tool-call owner.");
        }
        const resolve = () =>
          "requestedSchema" in params
            ? resolveMcpFormElicitation(interactionInput, interaction, {
                message: params.message,
                schema: params.requestedSchema as AgentInteractionInputSchema,
              })
            : resolveMcpUrlElicitation(interactionInput, interaction, {
                externalId: this.externalInteractionId(params.elicitationId),
                message: params.message,
                url: params.url,
              });
        if (!params.task) return resolve();
        if (!extra.taskStore) {
          throw new McpError(ErrorCode.InternalError, "MCP client task storage is unavailable for elicitation.");
        }

        const task = await extra.taskStore.createTask({ ttl: extra.taskRequestedTtl });
        void settleMcpElicitationTask(extra.taskStore, task.taskId, resolve()).catch((error) => {
          reportMcpBackgroundError(client, error);
        });
        return { task };
      });
    }
  }

  get closed(): boolean {
    return this._closed;
  }

  private externalInteractionId(elicitationId: string): string {
    return `${this.externalInteractionNamespace}:${elicitationId}`;
  }

  async callTool(name: string, args: Record<string, unknown>, options: AgentMcpToolCallOptions = {}): Promise<unknown> {
    return this.withInteractionScope(options, () => this.callToolWithinScope(name, args, options));
  }

  private async callToolWithinScope(
    name: string,
    args: Record<string, unknown>,
    options: AgentMcpToolCallOptions,
  ): Promise<unknown> {
    this.assertTaskEventCapability(options);
    const correlation = options.correlation;
    const outputToken = options.onOutput ? createOpaqueId("mcp_output") : undefined;
    const progressToken = options.resumableEvents && options.onProgress ? createOpaqueId("mcp_progress") : undefined;
    const taskEventState = options.resumableEvents ? createTaskEventDeliveryState(options) : undefined;
    if (outputToken && options.onOutput) this.outputHandlers.set(outputToken, options.onOutput);
    this.registerTaskEventState(taskEventState, outputToken, progressToken);
    const params = {
      name,
      arguments: args,
      ...(correlation || outputToken || progressToken
        ? {
            _meta: {
              ...(progressToken ? { progressToken } : {}),
              senera: {
                ...correlation,
                outputToken,
              },
            },
          }
        : {}),
    };
    try {
      const call = () =>
        options.task
          ? this.callToolTask(params, options)
          : this.client.callTool(params, undefined, mcpRequestOptions(this.options, options));
      try {
        return await call();
      } catch (error) {
        if (!(error instanceof UrlElicitationRequiredError)) throw error;
        await this.resolveRequiredUrlElicitations(error.elicitations, options);
        return await call();
      }
    } finally {
      if (outputToken) this.outputHandlers.delete(outputToken);
      this.unregisterTaskEventState(taskEventState, outputToken, progressToken);
    }
  }

  private async resolveRequiredUrlElicitations(
    requests: readonly ElicitRequestURLParams[],
    options: AgentMcpToolCallOptions,
  ): Promise<void> {
    const interactionInput = this.options.interactionInput;
    const interaction = this.activeInteraction;
    if (!interactionInput || !interaction) {
      throw new Error("MCP URL elicitation recovery requires an active Senera interaction owner.");
    }
    for (const request of requests) {
      const handle = interactionInput.requestExternal({
        owner: interaction.owner,
        mode: AgentInteractionInputModes.Url,
        externalId: this.externalInteractionId(request.elicitationId),
        message: request.message,
        url: request.url,
        signal: options.signal,
        onEvent: interaction.onEvent,
      });
      const response = await handle.response;
      if (response.action !== "accept") {
        throw new AgentMcpUrlElicitationDeclinedError(request.elicitationId, response.action);
      }
      const completion = await handle.completion;
      if (completion !== "completed") {
        throw new AgentMcpUrlElicitationDeclinedError(request.elicitationId, "cancel");
      }
    }
  }

  private async callToolTask(
    params: Parameters<AgentMcpToolClient["client"]["callTool"]>[0],
    options: AgentMcpToolCallOptions,
  ): Promise<unknown> {
    const deadline = Date.now() + this.options.requestTimeoutMs;
    let taskId: string | undefined;
    let cancellation: Promise<unknown> | undefined;
    const cancelTask = (): void => {
      if (!taskId || cancellation) return;
      cancellation = this.client.experimental.tasks.cancelTask(taskId, mcpTaskControlOptions(this.options));
    };
    const onAbort = (): void => cancelTask();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const stream = this.client.experimental.tasks.callToolStream(params, undefined, {
        ...mcpRequestOptions(this.options, options),
        task: {},
      });
      try {
        for await (const message of stream) {
          if (message.type === "taskCreated" || message.type === "taskStatus") {
            taskId = message.task.taskId;
            options.onTask?.(projectMcpTask(message.task));
            if (options.signal?.aborted) cancelTask();
            if (message.task.status === "failed") {
              await this.replayTaskEvents(taskId, options, deadline);
              return await this.client.experimental.tasks.getTaskResult(
                taskId,
                CallToolResultSchema,
                mcpTaskControlOptions(this.options),
              );
            }
            continue;
          }
          if (message.type === "result") {
            if (taskId) await this.replayTaskEvents(taskId, options, deadline);
            return message.result;
          }
          throw message.error;
        }
      } catch (error) {
        if (taskId && !options.signal?.aborted && this.isRecoverableTaskInterruption(error)) {
          throw new AgentMcpTaskDetachedError(params.name, taskId, { cause: error });
        }
        throw error;
      }
      throw new Error(`MCP task tool ${params.name} completed without a result.`);
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      if (options.signal?.aborted) cancelTask();
      await cancellation?.catch(() => undefined);
    }
  }

  async reattachTask(taskId: string, options: AgentMcpToolCallOptions = {}): Promise<unknown> {
    return this.withInteractionScope(options, () => this.reattachTaskWithinScope(taskId, options));
  }

  private async reattachTaskWithinScope(taskId: string, options: AgentMcpToolCallOptions): Promise<unknown> {
    const deadline = Date.now() + this.options.requestTimeoutMs;
    let cancellation: Promise<unknown> | undefined;
    const cancelTask = (): void => {
      if (cancellation) return;
      cancellation = this.client.experimental.tasks.cancelTask(taskId, mcpTaskControlOptions(this.options));
    };
    const onAbort = (): void => cancelTask();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      for (;;) {
        throwIfTaskAborted(options.signal);
        await this.replayTaskEvents(taskId, options, deadline);
        const task = await this.client.experimental.tasks.getTask(
          taskId,
          mcpTaskControlOptions(this.options, options.signal, deadline),
        );
        options.onTask?.(projectMcpTask(task));
        switch (task.status) {
          case "completed":
          case "failed":
            await this.replayTaskEvents(taskId, options, deadline);
            return this.client.experimental.tasks.getTaskResult(
              taskId,
              CallToolResultSchema,
              mcpTaskControlOptions(this.options, options.signal, deadline),
            );
          case "cancelled":
            throw new AgentMcpTaskCancelledError(taskId);
          case "input_required":
            if (!options.interactionOwner) throw new AgentMcpTaskInputRequiredError(taskId);
            await waitForTaskPoll(resolveTaskPollInterval(task.pollInterval), options.signal, deadline);
            break;
          case "working":
            await waitForTaskPoll(resolveTaskPollInterval(task.pollInterval), options.signal, deadline);
            break;
        }
      }
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      if (options.signal?.aborted) cancelTask();
      await cancellation?.catch(() => undefined);
    }
  }

  private isRecoverableTaskInterruption(error: unknown): boolean {
    return this._closed || (error instanceof McpError && error.code === ErrorCode.RequestTimeout);
  }

  private withInteractionScope<TValue>(
    options: AgentMcpToolCallOptions,
    operation: () => Promise<TValue>,
  ): Promise<TValue> {
    if (!this.options.interactionInput) return operation();
    const interactionOwner = options.interactionOwner;
    if (!interactionOwner) {
      throw new Error("An elicitation-enabled MCP call requires an interaction owner.");
    }
    return this.interactionLease.run(
      "elicitation",
      async () => {
        this.activeInteraction = {
          owner: interactionOwner,
          signal: options.signal,
          onEvent: options.interactionEventSink,
        };
        try {
          return await operation();
        } finally {
          this.activeInteraction = undefined;
        }
      },
      options.signal,
    );
  }

  private assertTaskEventCapability(options: AgentMcpToolCallOptions): void {
    if (!options.resumableEvents) return;
    if (!supportsAgentMcpTaskEvents(this.client.getServerCapabilities())) {
      throw new AgentMcpTaskEventCapabilityError(this.options.server.id);
    }
  }

  private async replayTaskEvents(taskId: string, options: AgentMcpToolCallOptions, deadline: number): Promise<void> {
    if (!options.resumableEvents) return;
    this.assertTaskEventCapability(options);
    const state = createTaskEventDeliveryState(options);
    for (;;) {
      const response = await this.client.request(
        {
          method: TaskEventsReadMethod,
          params: {
            taskId,
            afterCursor: state.cursor.value,
            limit: TaskEventPageLimit,
          },
        },
        AgentMcpTaskEventsReadResultSchema,
        mcpTaskControlOptions(this.options, options.signal, deadline),
      );
      for (const event of response.events) deliverAgentMcpTaskEvent(state, event);
      if (state.cursor.value !== response.nextCursor) {
        throw new AgentMcpTaskEventGapError(taskId, state.cursor.value, response.nextCursor);
      }
      if (!response.hasMore) return;
      if (response.nextCursor <= state.cursor.value) {
        throw new Error(`MCP task event replay did not advance beyond cursor ${state.cursor.value}.`);
      }
    }
  }

  private registerTaskEventState(
    state: AgentMcpTaskEventDeliveryState | undefined,
    ...tokens: Array<string | undefined>
  ): void {
    if (!state) return;
    for (const token of tokens) if (token) this.taskEventHandlers.set(token, state);
  }

  private unregisterTaskEventState(
    state: AgentMcpTaskEventDeliveryState | undefined,
    ...tokens: Array<string | undefined>
  ): void {
    if (!state) return;
    for (const token of tokens) {
      if (token && this.taskEventHandlers.get(token) === state) this.taskEventHandlers.delete(token);
    }
  }

  private readTaskEventState(
    outputToken: string | undefined,
    progressToken: string | undefined,
  ): AgentMcpTaskEventDeliveryState | undefined {
    return (
      (outputToken ? this.taskEventHandlers.get(outputToken) : undefined) ??
      (progressToken ? this.taskEventHandlers.get(progressToken) : undefined)
    );
  }

  async close(): Promise<void> {
    if (!this._closed) {
      this._closed = true;
      try {
        await this.client.close();
      } finally {
        this.disposeClientTaskStore();
      }
      return;
    }
    this.disposeClientTaskStore();
  }

  private disposeClientTaskStore(): void {
    if (this.clientTaskStoreDisposed) return;
    this.clientTaskStoreDisposed = true;
    this.clientTaskStore?.cleanup();
  }
}

async function resolveMcpFormElicitation(
  interactionInput: AgentInteractionInputRuntime,
  interaction: { owner: AgentInteractionInputOwner; signal?: AbortSignal; onEvent?: AgentEventSink },
  request: { message: string; schema: AgentInteractionInputSchema },
): Promise<ElicitResult> {
  const resolution = await interactionInput.request({
    owner: interaction.owner,
    mode: AgentInteractionInputModes.Form,
    message: request.message,
    schema: request.schema,
    signal: interaction.signal,
    onEvent: interaction.onEvent,
  });
  return {
    action: resolution.action,
    ...(resolution.content ? { content: resolution.content } : {}),
  };
}

async function resolveMcpUrlElicitation(
  interactionInput: AgentInteractionInputRuntime,
  interaction: { owner: AgentInteractionInputOwner; signal?: AbortSignal; onEvent?: AgentEventSink },
  request: { externalId: string; message: string; url: string },
): Promise<ElicitResult> {
  const resolution = await interactionInput.request({
    owner: interaction.owner,
    mode: AgentInteractionInputModes.Url,
    externalId: request.externalId,
    message: request.message,
    url: request.url,
    signal: interaction.signal,
    onEvent: interaction.onEvent,
  });
  return { action: resolution.action };
}

async function settleMcpElicitationTask(
  taskStore: RequestTaskStore,
  taskId: string,
  resolution: Promise<ElicitResult>,
): Promise<void> {
  try {
    await taskStore.storeTaskResult(taskId, "completed", await resolution);
  } catch {
    await taskStore.storeTaskResult(taskId, "failed", { action: "cancel" });
  }
}

function reportMcpBackgroundError(client: Pick<Client, "onerror">, error: unknown): void {
  try {
    client.onerror?.(error instanceof Error ? error : new Error(String(error)));
  } catch {
    // Error reporting must not create a second unhandled background rejection.
  }
}

interface AgentMcpTaskEventDeliveryState {
  readonly cursor: AgentMcpTaskEventCursor;
  readonly pending: Map<number, AgentMcpTaskEvent>;
  readonly onOutput?: AgentMcpToolCallOptions["onOutput"];
  readonly onProgress?: AgentMcpToolCallOptions["onProgress"];
}

function createTaskEventDeliveryState(options: AgentMcpToolCallOptions): AgentMcpTaskEventDeliveryState {
  return {
    cursor: options.taskEventCursor ?? { value: 0 },
    pending: new Map(),
    onOutput: options.onOutput,
    onProgress: options.onProgress,
  };
}

function deliverAgentMcpTaskEvent(state: AgentMcpTaskEventDeliveryState, event: AgentMcpTaskEvent): void {
  if (event.cursor <= state.cursor.value) return;
  state.pending.set(event.cursor, event);
  for (;;) {
    const cursor = state.cursor.value + 1;
    const next = state.pending.get(cursor);
    if (!next) return;
    state.pending.delete(cursor);
    if (next.kind === "output") {
      state.onOutput?.(next.output);
    } else {
      state.onProgress?.({
        progress: next.progress.completed,
        total: next.progress.total,
        message: next.progress.message,
      });
    }
    state.cursor.value = cursor;
  }
}

function mcpRequestOptions(options: AgentMcpToolClientOptions, call: AgentMcpToolCallOptions = {}): RequestOptions {
  const transientProgress = call.resumableEvents ? undefined : call.onProgress;
  return {
    signal: call.signal ?? options.signal,
    timeout: options.requestTimeoutMs,
    maxTotalTimeout: options.requestTimeoutMs,
    resetTimeoutOnProgress: Boolean(transientProgress),
    onprogress: transientProgress,
  };
}

function mcpTaskControlOptions(
  options: AgentMcpToolClientOptions,
  signal?: AbortSignal,
  deadline?: number,
): RequestOptions {
  const timeout = deadline === undefined ? options.requestTimeoutMs : Math.max(1, deadline - Date.now());
  return {
    signal,
    timeout,
    maxTotalTimeout: timeout,
  };
}

const DefaultMcpTaskPollIntervalMs = 1_000;

function resolveTaskPollInterval(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : DefaultMcpTaskPollIntervalMs;
}

function waitForTaskPoll(intervalMs: number, signal: AbortSignal | undefined, deadline: number): Promise<void> {
  throwIfTaskAborted(signal);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new McpError(ErrorCode.RequestTimeout, "MCP task reattachment timed out.");
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(settleResolve, Math.min(intervalMs, remaining));
    const onAbort = (): void => settleReject(new AgentCancellationError(readAbortMessage(signal)));
    signal?.addEventListener("abort", onAbort, { once: true });

    function settleResolve(): void {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }

    function settleReject(error: Error): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    }
  });
}

function throwIfTaskAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AgentCancellationError(readAbortMessage(signal));
}

function projectMcpTask(task: {
  taskId: string;
  status: AgentMcpToolTask["status"];
  statusMessage?: string;
  pollInterval?: number;
}): AgentMcpToolTask {
  return {
    taskId: task.taskId,
    status: task.status,
    statusMessage: task.statusMessage,
    pollInterval: task.pollInterval,
    terminal: task.status === "completed" || task.status === "failed" || task.status === "cancelled",
  };
}
