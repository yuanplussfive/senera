import { resolveToolExecutionConfig } from "../AgentDefaults.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";

export class AgentToolDeadlineExceededError extends AgentBaseError {
  constructor(readonly timeoutMs: number) {
    super(`Tool call exceeded the configured ${timeoutMs}ms deadline.`);
  }
}

export interface AgentToolDeadlineScope {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  close(): void;
}

export function resolveAgentToolCallTimeoutMs(config: AgentSystemConfig, requestedTimeoutMs?: number): number {
  const configuredTimeoutMs = resolveToolExecutionConfig(config).TimeoutMs;
  if (!Number.isFinite(configuredTimeoutMs) || configuredTimeoutMs <= 0) {
    throw new RangeError(
      `ToolExecution.TimeoutSeconds must resolve to a positive duration, received ${configuredTimeoutMs}ms.`,
    );
  }
  if (requestedTimeoutMs !== undefined && (!Number.isFinite(requestedTimeoutMs) || requestedTimeoutMs <= 0)) {
    throw new RangeError(`Requested tool timeout must be a positive duration, received ${requestedTimeoutMs}ms.`);
  }
  return Math.min(requestedTimeoutMs ?? configuredTimeoutMs, configuredTimeoutMs);
}

export function openAgentToolDeadline(config: AgentSystemConfig, parentSignal?: AbortSignal): AgentToolDeadlineScope {
  const timeoutMs = resolveAgentToolCallTimeoutMs(config);
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const clearTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const abort = (reason: unknown): void => {
    clearTimer();
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const onParentAbort = (): void => abort(parentSignal?.reason);

  if (parentSignal?.aborted) {
    abort(parentSignal.reason);
  } else {
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    timer = setTimeout(() => abort(new AgentToolDeadlineExceededError(timeoutMs)), timeoutMs);
    timer.unref();
  }

  return {
    signal: controller.signal,
    timeoutMs,
    close: () => {
      clearTimer();
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

export function readAgentToolDeadlineExceeded(signal?: AbortSignal): AgentToolDeadlineExceededError | undefined {
  return signal?.reason instanceof AgentToolDeadlineExceededError ? signal.reason : undefined;
}
