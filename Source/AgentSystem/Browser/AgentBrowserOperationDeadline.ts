import type { AgentBrowserDriverOperationOptions } from "./AgentBrowserDriver.js";

/** One deadline follows an operation through startup, commands and result reads. */
export async function withAgentBrowserOperationDeadline<T>(
  options: AgentBrowserDriverOperationOptions,
  operation: (options: AgentBrowserDriverOperationOptions) => Promise<T>,
): Promise<T> {
  if (options.deadlineAt !== undefined) return operation(options);
  const controller = new AbortController();
  const timeout = new DOMException(`Browser operation timed out after ${options.timeoutMs}ms.`, "TimeoutError");
  const deadlineAt = Date.now() + options.timeoutMs;
  const timer = setTimeout(() => controller.abort(timeout), options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const bounded: AgentBrowserDriverOperationOptions = {
    ...options,
    signal,
    deadlineAt,
    get timeoutMs() {
      signal.throwIfAborted();
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) {
        controller.abort(timeout);
        throw timeout;
      }
      return remaining;
    },
  };
  let rejectInterruption!: (reason: unknown) => void;
  const interruption = new Promise<never>((_resolve, reject) => {
    rejectInterruption = reject;
  });
  const interrupt = () => rejectInterruption(signal.reason);
  signal.addEventListener("abort", interrupt, { once: true });
  try {
    signal.throwIfAborted();
    const result = await Promise.race([
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return operation(bounded);
      }),
      interruption,
    ]);
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener("abort", interrupt);
    clearTimeout(timer);
  }
}
