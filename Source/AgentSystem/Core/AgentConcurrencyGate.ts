import { AgentCancellationError, readAbortMessage, throwIfAborted } from "./AgentCancellation.js";

type AgentConcurrencyLease = () => void;

interface AgentConcurrencyWaiter {
  readonly resolve: (lease: AgentConcurrencyLease) => void;
  readonly reject: (error: unknown) => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

export class AgentConcurrencyGate {
  private readonly waiters: AgentConcurrencyWaiter[] = [];
  private active = 0;

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError("Concurrency limit must be a positive safe integer.");
    }
  }

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      throwIfAborted(signal);
      const result = await operation();
      throwIfAborted(signal);
      return result;
    } finally {
      release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<AgentConcurrencyLease> {
    throwIfAborted(signal);
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.createLease());
    }

    return new Promise<AgentConcurrencyLease>((resolve, reject) => {
      if (!signal) {
        this.waiters.push({ resolve, reject });
        return;
      }
      const onAbort = (): void => {
        signal.removeEventListener("abort", onAbort);
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new AgentCancellationError(readAbortMessage(signal)));
      };
      const waiter: AgentConcurrencyWaiter = { resolve, reject, signal, onAbort };
      this.waiters.push(waiter);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }

  private createLease(): AgentConcurrencyLease {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.dispatch();
    };
  }

  private dispatch(): void {
    while (this.active < this.limit) {
      const waiter = this.waiters.shift();
      if (!waiter) return;
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
      if (waiter.signal?.aborted) {
        waiter.reject(new AgentCancellationError(readAbortMessage(waiter.signal)));
        continue;
      }
      this.active += 1;
      waiter.resolve(this.createLease());
    }
  }
}
