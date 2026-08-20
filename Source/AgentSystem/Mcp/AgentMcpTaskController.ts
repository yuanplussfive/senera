import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { AgentCancellationError, readAbortMessage } from "../Core/AgentCancellation.js";
import type { AgentMcpCallNotificationController } from "./AgentMcpCallNotificationController.js";
import {
  AgentMcpTaskCancelledError,
  AgentMcpTaskDetachedError,
  AgentMcpTaskInputRequiredError,
  type AgentMcpToolCallOptions,
  type AgentMcpToolClientOptions,
  type AgentMcpToolTask,
} from "./AgentMcpToolClientContracts.js";
import {
  agentMcpRequestDeadline,
  agentMcpRequestOptions,
  agentMcpTaskControlOptions,
} from "./AgentMcpToolClientRequestPolicy.js";

export class AgentMcpTaskController {
  constructor(
    private readonly client: Client,
    private readonly options: AgentMcpToolClientOptions,
    private readonly notifications: AgentMcpCallNotificationController,
    private readonly isClosed: () => boolean,
  ) {}

  async call(params: Parameters<Client["callTool"]>[0], options: AgentMcpToolCallOptions): Promise<unknown> {
    let taskId: string | undefined;
    let cancellation: Promise<unknown> | undefined;
    const cancelTask = (): void => {
      if (!taskId || cancellation) return;
      cancellation = this.client.experimental.tasks.cancelTask(taskId, agentMcpTaskControlOptions(this.options));
    };
    const onAbort = (): void => cancelTask();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const stream = this.client.experimental.tasks.callToolStream(params, undefined, {
        ...agentMcpRequestOptions(this.options, options),
        task: {},
      });
      try {
        for await (const message of stream) {
          if (message.type === "taskCreated" || message.type === "taskStatus") {
            taskId = message.task.taskId;
            options.onTask?.(projectTask(message.task));
            if (options.signal?.aborted) cancelTask();
            if (message.task.status === "failed") {
              await this.notifications.replay(taskId, options, agentMcpRequestDeadline(this.options));
              return await this.client.experimental.tasks.getTaskResult(
                taskId,
                CallToolResultSchema,
                agentMcpTaskControlOptions(this.options, options.signal),
              );
            }
            continue;
          }
          if (message.type === "result") {
            if (taskId) {
              await this.notifications.replay(taskId, options, agentMcpRequestDeadline(this.options));
            }
            return message.result;
          }
          throw message.error;
        }
      } catch (error) {
        if (taskId && !options.signal?.aborted && this.isRecoverableInterruption(error)) {
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

  async reattach(taskId: string, options: AgentMcpToolCallOptions): Promise<unknown> {
    let cancellation: Promise<unknown> | undefined;
    const cancelTask = (): void => {
      if (cancellation) return;
      cancellation = this.client.experimental.tasks.cancelTask(taskId, agentMcpTaskControlOptions(this.options));
    };
    const onAbort = (): void => cancelTask();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      for (;;) {
        throwIfTaskAborted(options.signal);
        await this.notifications.replay(taskId, options, agentMcpRequestDeadline(this.options));
        const task = await this.client.experimental.tasks.getTask(
          taskId,
          agentMcpTaskControlOptions(this.options, options.signal),
        );
        options.onTask?.(projectTask(task));
        switch (task.status) {
          case "completed":
          case "failed":
            await this.notifications.replay(taskId, options, agentMcpRequestDeadline(this.options));
            return this.client.experimental.tasks.getTaskResult(
              taskId,
              CallToolResultSchema,
              agentMcpTaskControlOptions(this.options, options.signal),
            );
          case "cancelled":
            throw new AgentMcpTaskCancelledError(taskId);
          case "input_required":
            if (!options.interactionOwner) throw new AgentMcpTaskInputRequiredError(taskId);
            await waitForTaskPoll(resolveTaskPollInterval(task.pollInterval), options.signal);
            break;
          case "working":
            await waitForTaskPoll(resolveTaskPollInterval(task.pollInterval), options.signal);
            break;
        }
      }
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      if (options.signal?.aborted) cancelTask();
      await cancellation?.catch(() => undefined);
    }
  }

  private isRecoverableInterruption(error: unknown): boolean {
    return this.isClosed() || (error instanceof McpError && error.code === ErrorCode.RequestTimeout);
  }
}

const DefaultMcpTaskPollIntervalMs = 1_000;

function resolveTaskPollInterval(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : DefaultMcpTaskPollIntervalMs;
}

function waitForTaskPoll(intervalMs: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfTaskAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(settleResolve, intervalMs);
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

function projectTask(task: {
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
