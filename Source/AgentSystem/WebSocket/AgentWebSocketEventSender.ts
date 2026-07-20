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
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly onFailure?: (failure: AgentWebSocketEventPersistenceFailure) => void;
}

export interface AgentWebSocketEventPersistenceHealth {
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
  private readonly writer: AgentRunEventWriter;
  private closed = false;

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
        if (queue.isIdle && this.persistenceQueues.get(sessionId) === queue) {
          this.persistenceQueues.delete(sessionId);
        }
      }),
    );
    await this.writer.flush();
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.flush();
    } finally {
      await this.writer.close();
    }
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
      { pendingEvents: 0, failedEvents: 0, overflowEvents: 0 },
    );
    const writerHealth = this.writer.health();
    return {
      ...queueHealth,
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
      queue = new PersistenceQueue(
        (events) => this.persistRunEventsNow(events),
        normalizePersistenceBatchSize(this.options.persistenceBatchSize),
        normalizePersistenceOptions(this.options.persistence, (failure) => {
          this.options.logger.error("执行事件持久化进入失败状态", {
            kind: failure.event.kind,
            requestId: failure.event.requestId,
            attempts: failure.attempts,
            reason: failure.reason,
            error: failure.error instanceof Error ? failure.error.message : String(failure.error),
          });
        }),
      );
      this.persistenceQueues.set(projected.sessionId!, queue);
    }
    return queue.enqueue(projected);
  }

  private persistRunEventsNow(events: readonly AgentEventEnvelope[]): Promise<void> {
    return this.writer.append(events);
  }
}

class PersistenceQueue {
  private readonly events: PendingPersistenceEvent[] = [];
  private scheduled?: NodeJS.Immediate;
  private retryTimer?: NodeJS.Timeout;
  private waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  private pressureWaiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  private failedEvents = 0;
  private overflowEvents = 0;
  private running = false;
  private terminalFailure?: unknown;

  constructor(
    private readonly persist: (events: readonly AgentEventEnvelope[]) => Promise<void>,
    private readonly batchSize: number,
    private readonly options: Required<AgentWebSocketEventPersistenceOptions>,
  ) {}

  get isIdle(): boolean {
    return this.events.length === 0 && this.scheduled === undefined && this.retryTimer === undefined && !this.running;
  }

  enqueue(event: AgentEventEnvelope): Promise<void> {
    const underPressure = this.events.length >= this.options.maxPendingEvents;
    if (underPressure) {
      this.overflowEvents += 1;
    }
    this.events.push({ event, attempts: 0 });
    this.schedule();
    if (this.terminalFailure) return Promise.reject(this.terminalFailure);
    if (!underPressure) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.pressureWaiters.push({ resolve, reject });
    });
  }

  flush(): Promise<void> {
    if (this.terminalFailure) return Promise.reject(this.terminalFailure);
    if (this.isIdle) return this.terminalFailure ? Promise.reject(this.terminalFailure) : Promise.resolve();
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.scheduled || this.retryTimer || this.running) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      const batch = this.events.splice(0, this.batchSize);
      void this.persistBatch(batch);
    });
  }

  health(): PersistenceQueueHealth {
    return {
      pendingEvents: this.events.length,
      failedEvents: this.failedEvents,
      overflowEvents: this.overflowEvents,
    };
  }

  private async persistBatch(batch: readonly PendingPersistenceEvent[]): Promise<void> {
    this.running = true;
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
      this.scheduleRetry();
    }
    this.running = false;
    this.releasePressureWaiters();
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
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
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
    if (this.events.length >= this.options.maxPendingEvents || this.running) return;
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
  if (!Number.isFinite(value) || value < 1) throw new RangeError("persistenceBatchSize must be positive.");
  return Math.trunc(value);
}

function normalizePersistenceOptions(
  options: AgentWebSocketEventPersistenceOptions | undefined,
  defaultOnFailure: (failure: AgentWebSocketEventPersistenceFailure) => void,
): Required<AgentWebSocketEventPersistenceOptions> {
  const resolved = {
    maxPendingEvents: options?.maxPendingEvents ?? DefaultPersistenceQueueLimit,
    maxAttempts: options?.maxAttempts ?? DefaultPersistenceMaxAttempts,
    retryDelayMs: options?.retryDelayMs ?? DefaultPersistenceRetryDelayMs,
    onFailure: options?.onFailure ?? defaultOnFailure,
  };
  if (!Number.isFinite(resolved.maxPendingEvents) || resolved.maxPendingEvents < 1) {
    throw new RangeError("maxPendingEvents must be positive.");
  }
  if (!Number.isFinite(resolved.maxAttempts) || resolved.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be positive.");
  }
  if (!Number.isFinite(resolved.retryDelayMs) || resolved.retryDelayMs < 0) {
    throw new RangeError("retryDelayMs must be non-negative.");
  }
  return {
    ...resolved,
    maxPendingEvents: Math.trunc(resolved.maxPendingEvents),
    maxAttempts: Math.trunc(resolved.maxAttempts),
    retryDelayMs: Math.trunc(resolved.retryDelayMs),
  };
}
