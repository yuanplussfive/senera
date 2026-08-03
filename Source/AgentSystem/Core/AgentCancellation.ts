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
