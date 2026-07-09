import {
  AgentCancellationError,
  readAbortMessage,
  throwIfAborted,
} from "../Core/AgentCancellation.js";

export interface AgentPiTurnGuardOptions<T> {
  phase: string;
  timeoutMs: number;
  signal?: AbortSignal;
  abort?: () => void | Promise<void>;
  run: () => Promise<T>;
}

export class AgentPiTurnPhaseTimeoutError extends Error {
  constructor(
    readonly phase: string,
    readonly timeoutMs: number,
  ) {
    super(`Pi 阶段超时：${phase}，超过 ${timeoutMs}ms。`);
    this.name = "AgentPiTurnPhaseTimeoutError";
  }
}

export async function runAgentPiGuardedPhase<T>(
  options: AgentPiTurnGuardOptions<T>,
): Promise<T> {
  throwIfAborted(options.signal);

  const task = Promise.resolve().then(options.run);
  const interruption = createInterruptionPromise(options);

  try {
    return await Promise.race([task, interruption]);
  } finally {
    interruption.dispose();
  }
}

interface InterruptionPromise extends Promise<never> {
  dispose(): void;
}

function createInterruptionPromise<T>(
  options: AgentPiTurnGuardOptions<T>,
): InterruptionPromise {
  const disposers: Array<() => void> = [];
  const promise = new Promise<never>((_resolve, reject) => {
    const rejectWith = (error: Error) => {
      void options.abort?.();
      reject(error);
    };

    if (isEnabledTimeout(options.timeoutMs)) {
      const timer = setTimeout(
        () => rejectWith(new AgentPiTurnPhaseTimeoutError(options.phase, options.timeoutMs)),
        options.timeoutMs,
      );
      disposers.push(() => clearTimeout(timer));
    }

    const signal = options.signal;
    if (signal) {
      const onAbort = () => rejectWith(new AgentCancellationError(readAbortMessage(signal)));
      signal.addEventListener("abort", onAbort, { once: true });
      disposers.push(() => signal.removeEventListener("abort", onAbort));
    }
  }) as InterruptionPromise;

  promise.dispose = () => {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
  };

  return promise;
}

function isEnabledTimeout(timeoutMs: number): boolean {
  return Number.isFinite(timeoutMs) && timeoutMs > 0;
}
