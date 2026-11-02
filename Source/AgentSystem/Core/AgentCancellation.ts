import { AgentBaseError } from "./AgentBaseError.js";

export class AgentCancellationError extends AgentBaseError {
  readonly kind = "AgentCancellationError" as const;

  constructor(message = "Run cancelled by user.") {
    super(message);
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AgentCancellationError(readAbortMessage(signal));
  }
}

/**
 * Throws the original abort reason when it is an Error. This is for callers
 * that combine user cancellation with a typed deadline signal and must retain
 * the distinction between the two at their boundary.
 */
export function throwAbortReason(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throwIfAborted(signal);
}

/**
 * Makes a promise cooperatively cancellable even when its implementation only
 * observes a signal after it has already started work.
 */
export function awaitWithAbortSignal<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwAbortReason(signal);
  if (!signal) return work;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void =>
      settle(() => {
        try {
          throwAbortReason(signal);
        } catch (error) {
          reject(error);
        }
      });

    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}

export function readAbortMessage(signal?: AbortSignal): string {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.message) {
    return reason.message;
  }
  if (typeof reason === "string" && reason.trim()) {
    return reason;
  }
  return "Run cancelled by user.";
}
