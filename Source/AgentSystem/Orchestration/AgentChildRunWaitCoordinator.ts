import { throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentChildRunStatuses, type AgentChildRunRecord } from "./AgentChildRunTypes.js";
import type { AgentChildRunWaitResult } from "./AgentDelegationRuntimeContracts.js";
import { waitForDelegationWithSignal } from "./AgentDelegationRuntimeSupport.js";

export interface AgentChildRunWaitCoordinatorOptions {
  readonly resolveTimeout: (requestedTimeoutMs: number | undefined) => number;
  readonly getRun: (id: string, parentSessionId: string) => AgentChildRunRecord | undefined;
  readonly getActiveCompletion: (id: string) => Promise<AgentChildRunRecord> | undefined;
}

/** Keeps observation timing separate from child execution and cancellation. */
export class AgentChildRunWaitCoordinator {
  private readonly stateWaiters = new Map<string, Set<() => void>>();

  constructor(private readonly options: AgentChildRunWaitCoordinatorOptions) {}

  wait(id: string, parentSessionId: string, signal?: AbortSignal): Promise<AgentChildRunRecord | undefined> {
    const record = this.options.getRun(id, parentSessionId);
    if (!record) return Promise.resolve(undefined);
    const completion = this.options.getActiveCompletion(id);
    return completion ? waitForDelegationWithSignal(completion, signal) : Promise.resolve(record);
  }

  async waitAny(
    ids: readonly string[],
    parentSessionId: string,
    requestedTimeoutMs: number | undefined,
    signal?: AbortSignal,
  ): Promise<AgentChildRunWaitResult> {
    return this.waitUntil(ids, parentSessionId, requestedTimeoutMs, signal, (runs) =>
      runs.some((run) => !run || isSettled(run.status)),
    );
  }

  async waitAll(
    ids: readonly string[],
    parentSessionId: string,
    requestedTimeoutMs: number | undefined,
    signal?: AbortSignal,
  ): Promise<AgentChildRunWaitResult> {
    return this.waitUntil(ids, parentSessionId, requestedTimeoutMs, signal, (runs) =>
      runs.every((run) => !run || isSettled(run.status)),
    );
  }

  private async waitUntil(
    ids: readonly string[],
    parentSessionId: string,
    requestedTimeoutMs: number | undefined,
    signal: AbortSignal | undefined,
    isSatisfied: (runs: readonly (AgentChildRunRecord | undefined)[]) => boolean,
  ): Promise<AgentChildRunWaitResult> {
    throwIfAborted(signal);
    const readRuns = (): (AgentChildRunRecord | undefined)[] =>
      ids.map((id) => this.options.getRun(id, parentSessionId));
    const initial = readRuns();
    if (isSatisfied(initial)) return { runs: initial, timedOut: false };

    const timeoutMs = this.options.resolveTimeout(requestedTimeoutMs);
    if (timeoutMs === 0) return { runs: initial, timedOut: true };

    const waitController = new AbortController();
    const forwardAbort = (): void => waitController.abort(signal?.reason);
    signal?.addEventListener("abort", forwardAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<true>((resolve) => {
        timer = setTimeout(() => resolve(true), timeoutMs);
        timer.unref();
      });
      const stateChange = this.waitForSettledState(ids, parentSessionId, waitController.signal, isSatisfied).then(
        () => false as const,
      );
      const timedOut = await Promise.race([stateChange, timeout]);
      return { runs: readRuns(), timedOut };
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
      if (!waitController.signal.aborted) {
        waitController.abort(new Error("Child-run wait completed."));
      }
    }
  }

  notify(childRunId: string | undefined): void {
    if (!childRunId) return;
    for (const waiter of [...(this.stateWaiters.get(childRunId) ?? [])]) waiter();
  }

  private waitForSettledState(
    ids: readonly string[],
    parentSessionId: string,
    signal: AbortSignal,
    isSatisfied: (runs: readonly (AgentChildRunRecord | undefined)[]) => boolean,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanups: Array<() => void> = [];
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        cleanups.splice(0).forEach((cleanup) => cleanup());
        action();
      };
      const onAbort = (): void => finish(() => reject(signal.reason));
      const onChange = (): void => {
        if (isSatisfied(ids.map((id) => this.options.getRun(id, parentSessionId)))) {
          finish(resolve);
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      for (const id of new Set(ids)) {
        const waiters = this.stateWaiters.get(id) ?? new Set<() => void>();
        waiters.add(onChange);
        this.stateWaiters.set(id, waiters);
        cleanups.push(() => {
          waiters.delete(onChange);
          if (waiters.size === 0) this.stateWaiters.delete(id);
        });
      }
      onChange();
    });
  }
}

function isSettled(status: AgentChildRunRecord["status"]): boolean {
  switch (status) {
    case AgentChildRunStatuses.Queued:
    case AgentChildRunStatuses.Running:
    case AgentChildRunStatuses.WrappingUp:
    case AgentChildRunStatuses.Cancelling:
      return false;
    case AgentChildRunStatuses.AwaitingSupervisor:
    case AgentChildRunStatuses.Completed:
    case AgentChildRunStatuses.PartialCompleted:
    case AgentChildRunStatuses.Interrupted:
    case AgentChildRunStatuses.TimedOut:
    case AgentChildRunStatuses.Failed:
    case AgentChildRunStatuses.Cancelled:
      return true;
  }
}
