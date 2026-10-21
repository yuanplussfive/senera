import { Worker } from "node:worker_threads";
import { awaitWithAbortSignal, throwAbortReason } from "../Core/AgentCancellation.js";
import {
  resolveAgentWorkerThreadData,
  resolveAgentWorkerThreadEntry,
  resolveAgentWorkerThreadExecArgv,
} from "../Core/AgentWorkerThread.js";
import {
  AgentEmbeddingPriorities,
  type AgentEmbeddingPriority,
  type AgentEmbeddingRequest,
  type AgentEmbeddingResult,
} from "../Vector/AgentEmbeddingContract.js";
import type { AgentCapabilityEmbeddingClient } from "./AgentCapabilitySearchIndex.js";
import {
  AgentLocalEmbeddingWorkerRequestTypes,
  AgentLocalEmbeddingWorkerResponseTypes,
  type AgentLocalEmbeddingWorkerRequest,
  type AgentLocalEmbeddingWorkerResponse,
} from "./AgentLocalEmbeddingWorkerProtocol.js";

/** Stable model identifier shared by the capability embedding cache. */
export const AgentLocalEmbeddingModelName = "ternlight-mini-cn";
export const AgentLocalEmbeddingDimensions = 384;
export const AgentLocalEmbeddingProviderId = "senera-local-embedding";

/**
 * A worker request is intentionally bounded so cancellation and foreground
 * queries can overtake catalog preparation between cohesive WASM work units.
 */
export const AgentLocalEmbeddingMaxBatchSize = 8;

interface PendingEmbeddingOperation {
  readonly resolve: (vectors: number[][] | undefined) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Local, offline bilingual (Chinese-English) sentence embedding client backed
 * by a WASM sentence encoder. Free of network calls and model-time downloads;
 * the engine ships inside the package. Query and document sides use distinct
 * role markers to improve retrieval alignment.
 */
export class AgentLocalEmbeddingClient implements AgentCapabilityEmbeddingClient {
  readonly providerId = AgentLocalEmbeddingProviderId;
  readonly dimensions = AgentLocalEmbeddingDimensions;
  readonly maxBatchSize = AgentLocalEmbeddingMaxBatchSize;
  private worker: Worker | undefined;
  private warmupPromise: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;
  private terminalError: Error | undefined;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingEmbeddingOperation>();

  /**
   * Initializes the bundled WASM engine outside a foreground retrieval. The
   * empty input is never retained or ranked; it only crosses the encoder's
   * initialization boundary so a persisted document-vector cache does not
   * leave the first real query paying model startup cost.
   */
  async prewarm(
    signal?: AbortSignal,
    priority: AgentEmbeddingPriority = AgentEmbeddingPriorities.Background,
  ): Promise<void> {
    throwAbortReason(signal);
    this.warmupPromise ??= this.submit({
      type: AgentLocalEmbeddingWorkerRequestTypes.Warmup,
      requestId: this.nextId(),
      priority,
    }).then(() => undefined);
    await awaitWithAbortSignal(this.warmupPromise, signal);
  }

  async embed(request: AgentEmbeddingRequest): Promise<AgentEmbeddingResult> {
    throwAbortReason(request.signal);
    if (request.input.length === 0) {
      return {
        model: AgentLocalEmbeddingModelName,
        vectors: [],
      };
    }
    const vectors = await this.submit(
      {
        type: AgentLocalEmbeddingWorkerRequestTypes.Embed,
        requestId: this.nextId(),
        priority: request.priority ?? AgentEmbeddingPriorities.Foreground,
        input: [...request.input],
        role: request.role,
      },
      request.signal,
    );
    if (!vectors) throw new Error("Local embedding worker did not return vectors.");
    return {
      model: AgentLocalEmbeddingModelName,
      vectors,
    };
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeWorker();
    return this.closePromise;
  }

  private submit(
    request: Exclude<AgentLocalEmbeddingWorkerRequest, { type: typeof AgentLocalEmbeddingWorkerRequestTypes.Cancel }>,
    signal?: AbortSignal,
  ): Promise<number[][] | undefined> {
    throwAbortReason(signal);
    if (this.closePromise) return Promise.reject(new Error("Local embedding worker is closed."));
    if (this.terminalError) return Promise.reject(this.terminalError);
    const worker = this.ensureWorker();
    return new Promise<number[][] | undefined>((resolve, reject) => {
      let settled = false;
      let unbind: () => void = () => undefined;
      const settle = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        this.pending.delete(request.requestId);
        unbind();
        callback();
      };
      const cancel = (): void =>
        settle(() => {
          try {
            worker.postMessage({ type: AgentLocalEmbeddingWorkerRequestTypes.Cancel, requestId: request.requestId });
          } catch {
            // The request was already rejected; worker teardown will reject
            // remaining operations through its normal terminal path.
          }
          try {
            throwAbortReason(signal);
          } catch (error) {
            reject(error);
          }
        });
      this.pending.set(request.requestId, {
        resolve: (vectors) => settle(() => resolve(vectors)),
        reject: (error) => settle(() => reject(error)),
      });
      try {
        worker.postMessage(request);
      } catch (error) {
        settle(() => reject(error));
        return;
      }
      // Bind after the operation is enqueued. If cancellation races with this
      // boundary, bindCancellation observes the already-aborted signal and
      // posts a matching cancellation rather than creating a tombstone for an
      // operation the worker never received.
      unbind = bindCancellation(signal, cancel);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const workerUrl = new URL(
      import.meta.url.endsWith(".ts") ? "./AgentLocalEmbeddingWorker.ts" : "./AgentLocalEmbeddingWorker.js",
      import.meta.url,
    );
    const worker = new Worker(resolveAgentWorkerThreadEntry(workerUrl), {
      execArgv: resolveAgentWorkerThreadExecArgv(),
      workerData: resolveAgentWorkerThreadData(workerUrl),
    });
    worker.unref();
    worker.on("message", (message: AgentLocalEmbeddingWorkerResponse) => this.handleWorkerResponse(message));
    worker.on("error", (error) => this.handleWorkerFailure(error));
    worker.on("exit", (code) => {
      if (!this.closePromise) {
        this.handleWorkerFailure(new Error(`Local embedding worker exited with code ${code}.`));
      }
    });
    this.worker = worker;
    return worker;
  }

  private handleWorkerResponse(message: AgentLocalEmbeddingWorkerResponse): void {
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    if (message.type === AgentLocalEmbeddingWorkerResponseTypes.Failed) {
      const error = new Error(message.error.message);
      error.name = message.error.name;
      pending.reject(error);
      return;
    }
    pending.resolve(message.vectors);
  }

  private handleWorkerFailure(error: unknown): void {
    if (this.closePromise || this.terminalError) return;
    const failure = error instanceof Error ? error : new Error(String(error));
    this.terminalError = failure;
    const worker = this.worker;
    worker?.removeAllListeners();
    this.worker = undefined;
    for (const pending of this.pending.values()) pending.reject(failure);
    this.pending.clear();
    if (worker) void worker.terminate();
  }

  private async closeWorker(): Promise<void> {
    const worker = this.worker;
    const closed = new Error("Local embedding worker is closed.");
    for (const pending of this.pending.values()) pending.reject(closed);
    this.pending.clear();
    this.worker = undefined;
    if (!worker) return;
    worker.removeAllListeners();
    await worker.terminate();
  }

  private nextId(): number {
    return this.nextRequestId++;
  }
}

function bindCancellation(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (!signal) return () => undefined;
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  return () => signal.removeEventListener("abort", onAbort);
}
