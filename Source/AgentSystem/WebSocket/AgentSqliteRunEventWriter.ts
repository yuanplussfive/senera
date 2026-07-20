import path from "node:path";
import { Worker } from "node:worker_threads";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import {
  AgentEventPersistenceStates,
  type AgentEventPersistenceState,
  type AgentRunEventWriter,
  type AgentRunEventWriterHealth,
} from "./AgentRunEventWriter.js";

export { AgentEventPersistenceStates } from "./AgentRunEventWriter.js";
export type {
  AgentEventPersistenceState,
  AgentRunEventWriter,
  AgentRunEventWriterHealth,
} from "./AgentRunEventWriter.js";

const DefaultWriterCloseTimeoutMs = 5_000;
const DefaultOutboxDrainBatchSize = 256;
const DefaultCommittedOutboxRetentionMs = 7 * 24 * 60 * 60 * 1_000;

interface AppendMessage {
  readonly type: "append";
  readonly requestId: number;
  readonly events: readonly AgentEventEnvelope[];
}

interface FlushMessage {
  readonly type: "flush";
  readonly requestId: number;
}

interface ShutdownMessage {
  readonly type: "shutdown";
  readonly requestId: number;
}

type WriterMessage = AppendMessage | FlushMessage | ShutdownMessage;

interface AckMessage {
  readonly type: "ack" | "closed";
  readonly requestId: number;
  readonly committedEventWatermarks?: Readonly<Record<string, number>>;
}

interface ReadyMessage {
  readonly type: "ready";
  readonly error?: {
    readonly name: string;
    readonly message: string;
    readonly code?: string;
    readonly retryable: boolean;
  };
}

interface NackMessage {
  readonly type: "nack";
  readonly requestId: number;
  readonly retryable: boolean;
  readonly error: { readonly name: string; readonly message: string; readonly code?: string };
}

type WorkerResponse = AckMessage | ReadyMessage | NackMessage;

interface PendingRequest {
  readonly message: WriterMessage;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

export interface AgentSqliteRunEventWriterOptions {
  readonly databasePath: string;
  readonly restartDelayMs?: number;
  readonly closeTimeoutMs?: number;
  readonly drainBatchSize?: number;
  readonly committedRetentionMs?: number;
}

export class AgentSqliteRunEventWriter implements AgentRunEventWriter {
  private readonly databasePath: string;
  private readonly restartDelayMs: number;
  private readonly closeTimeoutMs: number;
  private readonly drainBatchSize: number;
  private readonly committedRetentionMs: number;
  private worker?: Worker;
  private state: AgentEventPersistenceState = AgentEventPersistenceStates.Recovering;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private restartTimer?: NodeJS.Timeout;
  private closePromise?: Promise<void>;
  private committedBatches = 0;
  private readonly committedEventWatermarks: Record<string, number> = {};
  private failedBatches = 0;
  private restartCount = 0;
  private lastError?: string;
  private terminalError?: Error;

  constructor(options: AgentSqliteRunEventWriterOptions) {
    this.databasePath = path.resolve(options.databasePath);
    this.restartDelayMs = normalizeDelay(options.restartDelayMs);
    this.closeTimeoutMs = normalizeDelay(options.closeTimeoutMs ?? DefaultWriterCloseTimeoutMs);
    this.drainBatchSize = normalizePositiveInteger(
      options.drainBatchSize ?? DefaultOutboxDrainBatchSize,
      "drainBatchSize",
    );
    this.committedRetentionMs = normalizePositiveInteger(
      options.committedRetentionMs ?? DefaultCommittedOutboxRetentionMs,
      "committedRetentionMs",
    );
    this.startWorker();
  }

  append(events: readonly AgentEventEnvelope[]): Promise<void> {
    if (events.length === 0) return Promise.resolve();
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (this.state === AgentEventPersistenceStates.Draining || this.state === AgentEventPersistenceStates.Stopped) {
      return Promise.reject(new Error("事件持久化 writer 已停止接收新事件。"));
    }
    return this.send({ type: "append", requestId: this.nextId(), events });
  }

  flush(): Promise<void> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (this.state === AgentEventPersistenceStates.Stopped)
      return Promise.reject(new Error("事件持久化 writer 已关闭。"));
    return this.send({ type: "flush", requestId: this.nextId() });
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeWorker();
    return this.closePromise;
  }

  health(): AgentRunEventWriterHealth {
    return {
      state: this.state,
      pendingBatches: this.pending.size,
      committedBatches: this.committedBatches,
      committedEventWatermarks: { ...this.committedEventWatermarks },
      failedBatches: this.failedBatches,
      restartCount: this.restartCount,
      lastError: this.lastError,
    };
  }

  private startWorker(): void {
    if (this.state === AgentEventPersistenceStates.Draining || this.state === AgentEventPersistenceStates.Stopped)
      return;
    this.state = AgentEventPersistenceStates.Recovering;
    const workerUrl = new URL(
      import.meta.url.endsWith(".ts") ? "./AgentSqliteRunEventWriterWorker.ts" : "./AgentSqliteRunEventWriterWorker.js",
      import.meta.url,
    );
    const worker = new Worker(resolveWorkerEntry(workerUrl), {
      workerData: {
        databasePath: this.databasePath,
        drainBatchSize: this.drainBatchSize,
        committedRetentionMs: this.committedRetentionMs,
      },
      execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type")),
    });
    this.worker = worker;
    worker.on("message", (message: WorkerResponse) => this.handleResponse(message));
    worker.on("error", (error) => this.handleWorkerFailure(error));
    worker.on("exit", (code) => {
      if (this.state !== AgentEventPersistenceStates.Draining && this.state !== AgentEventPersistenceStates.Stopped) {
        this.handleWorkerFailure(new Error(`SQLite event writer worker exited with code ${code}.`));
      }
    });
  }

  private send(message: WriterMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.set(message.requestId, { message, resolve, reject });
      if (!this.worker) return;
      this.worker.postMessage(message);
    });
  }

  private handleResponse(message: WorkerResponse): void {
    if (message.type === "ready") {
      if (message.error) {
        const error = createError(message.error);
        this.lastError = error.message;
        if (message.error.retryable) {
          this.handleWorkerFailure(error);
        } else {
          this.state = AgentEventPersistenceStates.Degraded;
          this.terminalError = error;
          this.rejectPending(error);
        }
      } else if (this.state === AgentEventPersistenceStates.Recovering) {
        this.state = AgentEventPersistenceStates.Healthy;
        this.lastError = undefined;
        this.terminalError = undefined;
      }
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    if (message.type === "nack") {
      this.failedBatches += 1;
      const error = new Error(message.error.message);
      error.name = message.error.name;
      pending.reject(error);
      if (!message.retryable) {
        this.lastError = message.error.message;
        this.state = AgentEventPersistenceStates.Degraded;
      }
      return;
    }
    if (message.type === "ack") {
      if (pending.message.type === "append") this.committedBatches += 1;
      for (const [sessionId, sequence] of Object.entries(message.committedEventWatermarks ?? {})) {
        this.committedEventWatermarks[sessionId] = Math.max(this.committedEventWatermarks[sessionId] ?? 0, sequence);
      }
    }
    pending.resolve();
    if (this.pending.size === 0 && this.state === AgentEventPersistenceStates.Recovering) {
      this.state = AgentEventPersistenceStates.Healthy;
      this.lastError = undefined;
    }
  }

  private handleWorkerFailure(error: unknown): void {
    if (this.state === AgentEventPersistenceStates.Draining || this.state === AgentEventPersistenceStates.Stopped)
      return;
    this.state = AgentEventPersistenceStates.Degraded;
    this.lastError = error instanceof Error ? error.message : String(error);
    this.restartCount += 1;
    const worker = this.worker;
    worker?.removeAllListeners();
    if (worker) void worker.terminate();
    this.worker = undefined;
    if (!this.restartTimer) {
      this.restartTimer = setTimeout(() => {
        this.restartTimer = undefined;
        this.startWorker();
        for (const request of this.pending.values()) this.worker?.postMessage(request.message);
      }, this.restartDelayMs);
      this.restartTimer.unref();
    }
  }

  private async closeWorker(): Promise<void> {
    this.state = AgentEventPersistenceStates.Draining;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    const worker = this.worker;
    if (!worker) {
      this.state = AgentEventPersistenceStates.Stopped;
      this.rejectPending(new Error("事件持久化 writer 没有可用 Worker。"));
      return;
    }
    try {
      await Promise.race([
        this.send({ type: "shutdown", requestId: this.nextId() }),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error("事件持久化 writer 关闭超时。")), this.closeTimeoutMs);
          timer.unref();
        }),
      ]);
    } finally {
      await worker.terminate();
      this.worker = undefined;
      this.state = AgentEventPersistenceStates.Stopped;
      this.rejectPending(new Error("事件持久化 writer 在关闭前仍有未完成请求。"));
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private nextId(): number {
    return this.nextRequestId++;
  }
}

function normalizeDelay(value: number | undefined): number {
  if (value === undefined) return 250;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("restartDelayMs must be a non-negative safe integer.");
  return value;
}

function normalizePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
  return value;
}

function resolveWorkerEntry(workerUrl: URL): URL {
  if (!workerUrl.pathname.endsWith(".ts")) return workerUrl;
  const tsxApiUrl = import.meta.resolve("tsx/esm/api");
  const source = [
    `import { tsImport } from ${JSON.stringify(tsxApiUrl)};`,
    `await tsImport(${JSON.stringify(workerUrl.href)}, import.meta.url);`,
  ].join("\n");
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

function createError(error: { readonly name: string; readonly message: string; readonly code?: string }): Error {
  const result = new Error(error.message);
  result.name = error.name;
  if (error.code) Object.assign(result, { code: error.code });
  return result;
}
