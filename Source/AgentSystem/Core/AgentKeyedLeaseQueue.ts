import { AgentCancellationError, readAbortMessage, throwIfAborted } from "./AgentCancellation.js";

export type AgentLeaseRelease = () => void;

export class AgentKeyedLeaseQueue<TKey> {
  private readonly tails = new Map<TKey, Promise<void>>();

  async acquire(key: TKey, signal?: AbortSignal): Promise<AgentLeaseRelease> {
    throwIfAborted(signal);
    const previous = this.tails.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.tails.set(key, tail);

    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      releaseCurrent();
      void tail.finally(() => {
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
    };

    try {
      await waitForAbortablePromise(
        previous.catch(() => undefined),
        signal,
      );
      throwIfAborted(signal);
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }

  async run<TValue>(key: TKey, operation: () => Promise<TValue>, signal?: AbortSignal): Promise<TValue> {
    const release = await this.acquire(key, signal);
    try {
      throwIfAborted(signal);
      const value = await operation();
      throwIfAborted(signal);
      return value;
    } finally {
      release();
    }
  }
}

function waitForAbortablePromise(completion: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return completion;
  throwIfAborted(signal);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void => settle(() => reject(new AgentCancellationError(readAbortMessage(signal))));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    void completion.then(
      () => settle(resolve),
      (error) => settle(() => reject(error)),
    );
  });
}
