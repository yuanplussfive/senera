import { type WebSocket } from "ws";
import {
  AgentEventSequencer,
  type AgentDomainEvent,
  type AgentEventEnvelope,
  toEventEnvelope,
} from "../Events/AgentEvent.js";
import { type AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentServerEventLogger } from "../Diagnostics/AgentServerEventLogger.js";
import { projectAgentRunEventForHistory } from "../Events/AgentRunEventHistoryPolicy.js";
import type { AgentEventPersistenceState, AgentRunEventWriter } from "./AgentRunEventWriter.js";
import { errorMessage } from "../Core/AgentErrors.js";

const DefaultPersistenceBatchSize = 128;
const DefaultPersistenceQueueLimit = 8_192;
const DefaultPersistenceMaxAttempts = 3;
const DefaultPersistenceRetryDelayMs = 50;

export interface AgentWebSocketEventPersistenceFailure {
  readonly event: AgentEventEnvelope;
  readonly error: unknown;
  readonly attempts: number;
  readonly reason: "write_failed" | "queue_overflow";
}

export interface AgentWebSocketEventPersistenceOptions {
  readonly maxPendingEvents?: number;
  readonly backpressureAtEvents?: number;
  readonly resumeAtEvents?: number;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly onFailure?: (failure: AgentWebSocketEventPersistenceFailure) => void;
}

export interface AgentWebSocketEventPersistenceHealth {
  readonly activeQueues: number;
  readonly pendingEvents: number;
  readonly failedEvents: number;
  readonly overflowEvents: number;
  readonly state: AgentEventPersistenceState;
  readonly committedBatches: number;
  readonly committedEventWatermarks: Readonly<Record<string, number>>;
  readonly failedBatches: number;
  readonly restartCount: number;
  readonly lastError?: string;
}

export class AgentWebSocketEventEnvelopeSender {
  private readonly sequencer = new AgentEventSequencer();
  private readonly persistenceQueues = new Map<string, PersistenceQueue>();
  private readonly retiredQueueHealth = {
    pendingEvents: 0,
    failedEvents: 0,
    overflowEvents: 0,
  };
  private readonly writer: AgentRunEventWriter;
  private readonly persistenceBatchSize: number;
  private readonly persistenceOptions: Required<AgentWebSocketEventPersistenceOptions>;
  private closed = false;
  private closePromise?: Promise<void>;

  constructor(
    private readonly options: {
      logger: AgentLogger;
      eventWriter: AgentRunEventWriter;
      eventLogger?: AgentServerEventLogger;
      maxBufferedBytes?: number;
      persistenceBatchSize?: number;
      persistence?: AgentWebSocketEventPersistenceOptions;
    },
  ) {
    this.writer = options.eventWriter;
    this.persistenceBatchSize = normalizePersistenceBatchSize(options.persistenceBatchSize);
    this.persistenceOptions = normalizePersistenceOptions(options.persistence, (failure) => {
      options.logger.error("执行事件持久化进入失败状态", {
        kind: failure.event.kind,
        requestId: failure.event.requestId,
        attempts: failure.attempts,
        reason: failure.reason,
        error: errorMessage(failure.error),
      });
    });
  }

  broadcast(clients: Iterable<WebSocket>, event: AgentDomainEvent): Promise<void> {
    if (this.closed) return Promise.resolve();
    const envelope = toEventEnvelope(event, this.sequencer.next());
    this.logEvent(envelope);
    const persisted = this.persistRunEvent(envelope);
    const payload = this.serialize(envelope);
    for (const client of clients) {
      this.send(client, payload);
    }
    return persisted;
  }

  sendEnvelope(socket: WebSocket, event: AgentDomainEvent): Promise<void> {
    if (this.closed) return Promise.resolve();
    const envelope = toEventEnvelope(event, this.sequencer.next());
    this.logEvent(envelope);
    const persisted = this.persistRunEvent(envelope);
    this.send(socket, this.serialize(envelope));
    return persisted;
  }

  async flush(): Promise<void> {
    const queues = [...this.persistenceQueues.entries()];
    await Promise.all(
      queues.map(async ([sessionId, queue]) => {
        await queue.flush();
        this.retireQueue(sessionId, queue);
      }),
    );
    await this.writer.flush();
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.closeSender());
  }

  persistenceHealth(): AgentWebSocketEventPersistenceHealth {
    const queueHealth = [...this.persistenceQueues.values()].reduce(
      (health, queue) => {
        const current = queue.health();
        return {
          pendingEvents: health.pendingEvents + current.pendingEvents,
          failedEvents: health.failedEvents + current.failedEvents,
          overflowEvents: health.overflowEvents + current.overflowEvents,
        };
      },
      { ...this.retiredQueueHealth },
    );
    const writerHealth = this.writer.health();
    return {
      ...queueHealth,
      activeQueues: this.persistenceQueues.size,
      state: writerHealth.state,
      committedBatches: writerHealth.committedBatches,
      committedEventWatermarks: writerHealth.committedEventWatermarks,
      failedBatches: writerHealth.failedBatches,
      restartCount: writerHealth.restartCount,
      lastError: writerHealth.lastError,
    };
  }

  private send(socket: WebSocket, payload: string): void {
    if (socket.readyState !== socket.OPEN) {
      return;
    }

    const maxBufferedBytes = this.options.maxBufferedBytes;
    const pendingBytes = socket.bufferedAmount + Buffer.byteLength(payload);
    if (maxBufferedBytes !== undefined && pendingBytes > maxBufferedBytes) {
      this.options.logger.warn("WebSocket client exceeded the outbound buffer limit.", {
        bufferedBytes: socket.bufferedAmount,
        pendingBytes,
        maxBufferedBytes,
      });
      socket.close(1013, "outbound_buffer_exceeded");
      return;
    }

    socket.send(payload);
  }

  private serialize(payload: unknown): string {
    return JSON.stringify(payload);
  }

  private logEvent(envelope: AgentEventEnvelope): void {
    this.options.eventLogger?.event(envelope);
  }

  private persistRunEvent(envelope: AgentEventEnvelope): Promise<void> {
    const projected = projectAgentRunEventForHistory(envelope);
    if (!projected) {
      return Promise.resolve();
    }

    let queue = this.persistenceQueues.get(projected.sessionId!);
    if (!queue) {
      const sessionId = projected.sessionId!;
      queue = new PersistenceQueue(
        (events) => this.persistRunEventsNow(events),
        this.persistenceBatchSize,
        this.persistenceOptions,
        () => this.retireQueue(sessionId, queue!),
      );
      this.persistenceQueues.set(sessionId, queue);
    }
    return queue.enqueue(projected);
  }

  private persistRunEventsNow(events: readonly AgentEventEnvelope[]): Promise<void> {
    return this.writer.append(events);
  }

  private retireQueue(sessionId: string, queue: PersistenceQueue): void {
    if (!queue.isIdle || this.persistenceQueues.get(sessionId) !== queue) return;
    const health = queue.health();
    this.retiredQueueHealth.failedEvents += health.failedEvents;
    this.retiredQueueHealth.overflowEvents += health.overflowEvents;
    this.persistenceQueues.delete(sessionId);
  }

  private async closeSender(): Promise<void> {
    this.closed = true;
    const failures: unknown[] = [];
    try {
      await this.flush();
    } catch (error) {
      failures.push(error);
    } finally {
      for (const queue of this.persistenceQueues.values()) queue.stop();
    }
    try {
      await this.writer.close();
    } catch (error) {
      failures.push(error);
    }
    throwShutdownFailures(failures, "WebSocket event sender shutdown failed.");
  }
}

class PersistenceQueue {
  private readonly events: PendingPersistenceEvent[] = [];
  private activeBatch: readonly PendingPersistenceEvent[] = [];
  private scheduled?: NodeJS.Immediate;
  private retryTimer?: NodeJS.Timeout;
  private waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  private pressureWaiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  private failedEvents = 0;
  private overflowEvents = 0;
  private terminalFailure?: unknown;
  private stoppedError?: Error;

  constructor(
    private readonly persist: (events: readonly AgentEventEnvelope[]) => Promise<void>,
    private readonly batchSize: number,
    private readonly options: Required<AgentWebSocketEventPersistenceOptions>,
    private readonly onIdle: () => void,
  ) {}

  get isIdle(): boolean {
    return this.pendingEventCount === 0 && this.scheduled === undefined && this.retryTimer === undefined;
  }

  enqueue(event: AgentEventEnvelope): Promise<void> {
    if (this.stoppedError) return Promise.reject(this.stoppedError);
    if (this.terminalFailure) return Promise.reject(this.terminalFailure);
    if (this.pendingEventCount >= this.options.maxPendingEvents) {
      this.overflowEvents += 1;
      const error = new Error(
        `Persistence queue reached its hard limit of ${this.options.maxPendingEvents} pending events.`,
      );
      this.reportFailure(event, error, 0, "queue_overflow");
      return Promise.reject(error);
    }
    this.events.push({ event, attempts: 0 });
    this.schedule();
    if (this.pendingEventCount < this.options.backpressureAtEvents) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.pressureWaiters.push({ resolve, reject });
    });
  }

  flush(): Promise<void> {
    if (this.stoppedError) return Promise.reject(this.stoppedError);
    if (this.terminalFailure) return Promise.reject(this.terminalFailure);
    if (this.isIdle) return this.terminalFailure ? Promise.reject(this.terminalFailure) : Promise.resolve();
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.stoppedError || this.terminalFailure || this.scheduled || this.retryTimer || this.activeBatch.length > 0) {
      return;
    }
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      const batch = this.events.splice(0, this.batchSize);
      this.activeBatch = batch;
      void this.persistBatch(batch);
    });
  }

  health(): PersistenceQueueHealth {
    return {
      pendingEvents: this.pendingEventCount,
      failedEvents: this.failedEvents,
      overflowEvents: this.overflowEvents,
    };
  }

  stop(): void {
    if (this.stoppedError) return;
    this.stoppedError = new Error("Persistence queue is closed.", { cause: this.terminalFailure });
    if (this.scheduled) {
      clearImmediate(this.scheduled);
      this.scheduled = undefined;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.rejectWaiters(this.terminalFailure ?? this.stoppedError);
  }

  private async persistBatch(batch: readonly PendingPersistenceEvent[]): Promise<void> {
    try {
      await this.persist(batch.map((pending) => pending.event));
      this.terminalFailure = undefined;
    } catch (error) {
      this.events.unshift(...batch);
      for (const pending of batch) {
        pending.attempts += 1;
        if (pending.attempts === this.options.maxAttempts) {
          this.failedEvents += 1;
          this.terminalFailure = error;
          this.reportFailure(pending.event, error, pending.attempts, "write_failed");
        }
      }
      if (this.terminalFailure) this.rejectWaiters(this.terminalFailure);
      else this.scheduleRetry();
    }
    this.activeBatch = [];
    this.releasePressureWaiters();
    if (this.stoppedError || this.terminalFailure) return;
    if (this.events.length > 0 && !this.retryTimer) {
      this.schedule();
      return;
    }
    if (this.events.length === 0 && !this.retryTimer) {
      const waiters = this.waiters.splice(0);
      for (const waiter of waiters) {
        if (this.terminalFailure) waiter.reject(this.terminalFailure);
        else waiter.resolve();
      }
      this.onIdle();
    }
  }

  private scheduleRetry(): void {
    if (this.stoppedError || this.terminalFailure || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.schedule();
    }, this.options.retryDelayMs);
    this.retryTimer.unref();
  }

  private releasePressureWaiters(): void {
    if (this.terminalFailure) {
      const waiters = this.pressureWaiters.splice(0);
      for (const waiter of waiters) waiter.reject(this.terminalFailure);
      return;
    }
    if (this.pendingEventCount > this.options.resumeAtEvents) return;
    const waiters = this.pressureWaiters.splice(0);
    for (const waiter of waiters) waiter.resolve();
  }

  private reportFailure(
    event: AgentEventEnvelope,
    error: unknown,
    attempts: number,
    reason: AgentWebSocketEventPersistenceFailure["reason"],
  ): void {
    try {
      this.options.onFailure({ event, error, attempts, reason });
    } catch {
      // Failure reporting must not interrupt queue draining or leave flush waiters unresolved.
    }
  }

  private rejectWaiters(error: unknown): void {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
    const pressureWaiters = this.pressureWaiters.splice(0);
    for (const waiter of pressureWaiters) waiter.reject(error);
  }

  private get pendingEventCount(): number {
    return this.events.length + this.activeBatch.length;
  }
}

function throwShutdownFailures(failures: readonly unknown[], message: string): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}

interface PendingPersistenceEvent {
  readonly event: AgentEventEnvelope;
  attempts: number;
}

interface PersistenceQueueHealth {
  readonly pendingEvents: number;
  readonly failedEvents: number;
  readonly overflowEvents: number;
}

function normalizePersistenceBatchSize(value: number | undefined): number {
  if (value === undefined) return DefaultPersistenceBatchSize;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("persistenceBatchSize must be a positive safe integer.");
  }
  return value;
}

function normalizePersistenceOptions(
  options: AgentWebSocketEventPersistenceOptions | undefined,
  defaultOnFailure: (failure: AgentWebSocketEventPersistenceFailure) => void,
): Required<AgentWebSocketEventPersistenceOptions> {
  const resolved = {
    maxPendingEvents: options?.maxPendingEvents ?? DefaultPersistenceQueueLimit,
    backpressureAtEvents: options?.backpressureAtEvents,
    resumeAtEvents: options?.resumeAtEvents,
    maxAttempts: options?.maxAttempts ?? DefaultPersistenceMaxAttempts,
    retryDelayMs: options?.retryDelayMs ?? DefaultPersistenceRetryDelayMs,
    onFailure: options?.onFailure ?? defaultOnFailure,
  };
  if (!Number.isSafeInteger(resolved.maxPendingEvents) || resolved.maxPendingEvents < 1) {
    throw new RangeError("maxPendingEvents must be a positive safe integer.");
  }
  const backpressureAtEvents =
    resolved.backpressureAtEvents ?? Math.max(1, Math.floor(resolved.maxPendingEvents * 0.75));
  const resumeAtEvents = resolved.resumeAtEvents ?? Math.floor(backpressureAtEvents / 2);
  if (
    !Number.isSafeInteger(backpressureAtEvents) ||
    backpressureAtEvents < 1 ||
    backpressureAtEvents > resolved.maxPendingEvents
  ) {
    throw new RangeError("backpressureAtEvents must be between 1 and maxPendingEvents.");
  }
  if (!Number.isSafeInteger(resumeAtEvents) || resumeAtEvents < 0 || resumeAtEvents >= backpressureAtEvents) {
    throw new RangeError("resumeAtEvents must be non-negative and less than backpressureAtEvents.");
  }
  if (!Number.isSafeInteger(resolved.maxAttempts) || resolved.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(resolved.retryDelayMs) || resolved.retryDelayMs < 0) {
    throw new RangeError("retryDelayMs must be a non-negative safe integer.");
  }
  return {
    maxPendingEvents: resolved.maxPendingEvents,
    backpressureAtEvents,
    resumeAtEvents,
    maxAttempts: resolved.maxAttempts,
    retryDelayMs: resolved.retryDelayMs,
    onFailure: resolved.onFailure,
  };
}
