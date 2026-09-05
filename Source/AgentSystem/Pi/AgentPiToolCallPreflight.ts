import { isDeepStrictEqual } from "node:util";

export interface AgentPiToolCallPreflightInput {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly purpose?: string;
}

export interface AgentPiToolCallPreflightResult {
  readonly block?: boolean;
  readonly reason?: string;
}

export type AgentPiToolCallPreflight = (
  input: AgentPiToolCallPreflightInput,
) => Promise<AgentPiToolCallPreflightResult | undefined>;

interface AgentPiToolCallBatchState {
  readonly batchId: string;
  readonly calls: readonly AgentPiToolCallPreflightInput[];
  preflights?: ReadonlyMap<string, Promise<AgentPiToolCallPreflightResult | undefined>>;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

/** Coordinates Pi's per-call hook with the complete provider tool-call batch. */
export class AgentPiToolCallPreflightCoordinator {
  private readonly batchesByCallId = new Map<string, AgentPiToolCallBatchState>();

  register(batchId: string, calls: readonly AgentPiToolCallPreflightInput[]): void {
    if (!batchId.trim()) throw new Error("Pi tool preflight batch id must not be empty.");
    if (calls.length === 0) throw new Error(`Pi tool preflight batch ${batchId} must contain at least one call.`);

    const callIds = new Set<string>();
    for (const call of calls) {
      if (!call.toolCallId.trim()) throw new Error(`Pi tool preflight batch ${batchId} contains an empty call id.`);
      if (callIds.has(call.toolCallId) || this.batchesByCallId.has(call.toolCallId)) {
        throw new Error(`Pi tool call ${call.toolCallId} is already registered for preflight.`);
      }
      callIds.add(call.toolCallId);
    }

    const state: AgentPiToolCallBatchState = {
      batchId,
      calls: calls.map((call) => ({ ...call })),
    };
    for (const call of calls) this.batchesByCallId.set(call.toolCallId, state);
  }

  unregister(batchId: string): void {
    const batch = [...this.batchesByCallId.values()].find((candidate) => candidate.batchId === batchId);
    if (!batch) return;
    if (batch.preflights) throw new Error(`Pi tool preflight batch ${batchId} has already started.`);
    for (const call of batch.calls) this.batchesByCallId.delete(call.toolCallId);
  }

  batchId(callId: string | undefined): string | undefined {
    return callId ? this.batchesByCallId.get(callId)?.batchId : undefined;
  }

  batchIndex(callId: string): number | undefined {
    const batch = this.batchesByCallId.get(callId);
    const index = batch?.calls.findIndex((call) => call.toolCallId === callId) ?? -1;
    return index >= 0 ? index : undefined;
  }

  purpose(callId: string): string | undefined {
    return this.batchesByCallId.get(callId)?.calls.find((call) => call.toolCallId === callId)?.purpose;
  }

  async run(
    event: AgentPiToolCallPreflightInput,
    maxConcurrentCalls: number,
    preflight: AgentPiToolCallPreflight,
  ): Promise<AgentPiToolCallPreflightResult | undefined> {
    const batch = this.batchesByCallId.get(event.toolCallId);
    if (!batch) return preflight(event);

    const registered = batch.calls.find((call) => call.toolCallId === event.toolCallId);
    if (!registered || registered.toolName !== event.toolName || !isDeepStrictEqual(registered.input, event.input)) {
      throw new Error(`Pi tool call ${event.toolCallId} does not match its registered preflight batch.`);
    }

    batch.preflights ??= schedulePreflights(batch.calls, maxConcurrentCalls, preflight);
    const result = batch.preflights.get(event.toolCallId);
    if (!result) throw new Error(`Pi tool call ${event.toolCallId} has no registered preflight result.`);
    return result;
  }
}

function schedulePreflights(
  calls: readonly AgentPiToolCallPreflightInput[],
  maxConcurrentCalls: number,
  preflight: AgentPiToolCallPreflight,
): ReadonlyMap<string, Promise<AgentPiToolCallPreflightResult | undefined>> {
  if (!Number.isInteger(maxConcurrentCalls) || maxConcurrentCalls < 1) {
    throw new Error("Pi tool preflight concurrency must be a positive integer.");
  }

  const pending = calls.map((call) => ({
    call,
    deferred: createDeferred<AgentPiToolCallPreflightResult | undefined>(),
  }));
  let nextIndex = 0;
  const runWorker = async (): Promise<void> => {
    while (nextIndex < pending.length) {
      const index = nextIndex++;
      const entry = pending[index];
      if (!entry) return;
      try {
        entry.deferred.resolve(await preflight(entry.call));
      } catch (error) {
        entry.deferred.reject(error);
      }
    }
  };

  const workerCount = Math.min(maxConcurrentCalls, calls.length);
  for (let index = 0; index < workerCount; index += 1) void runWorker();

  return new Map(pending.map(({ call, deferred }) => [call.toolCallId, deferred.promise]));
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
