import type {
  AgentChannelAdapter,
  AgentChannelSendResult,
  AgentChannelSource,
  AgentChannelSendReplyOptions,
} from "./AgentChannelTypes.js";
import { serializeAgentChannelLane } from "./AgentChannelSessionIdentity.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import type { AgentChannelOutbox, AgentChannelOutboxEntry } from "./AgentChannelOutbox.js";
import { AgentChannelHttpError } from "./AgentChannelHttpTransport.js";

export const AgentChannelDeliveryDefaults = Object.freeze({
  /** Attempts per individual send before a terminal failure is reported. */
  maxAttempts: 3,
  /** Exponential backoff base for transient network failures. */
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 30_000,
  /** Per-lane send queue depth; overflow rejects while keeping order. */
  laneQueueLimit: 32,
  /** Retry after a platform flood-control reply (seconds multiplier). */
  floodRetryMultiplierMs: 1_000,
});

export interface AgentChannelDeliveryOptions {
  readonly adapter: AgentChannelAdapter;
  readonly outbox?: AgentChannelOutbox;
  readonly authorize?: (source: AgentChannelSource) => boolean;
  readonly maxAttempts?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly laneQueueLimit?: number;
  readonly floodRetryMultiplierMs?: number;
  readonly onError?: (error: unknown, source?: AgentChannelSource) => void;
  readonly onDropped?: (
    content: string,
    source: AgentChannelSource,
    error: unknown,
    options?: AgentChannelSendReplyOptions,
  ) => void;
}

export type AgentChannelDeliveryFailureCode =
  "queue_full" | "stopped" | "unsupported" | "retry_exhausted" | "delivery_unknown" | "revoked" | "storage_failed";

export type AgentChannelDeliveryReceipt =
  | {
      readonly status: "sent";
      readonly messageId: string;
      readonly attempts: number;
    }
  | {
      readonly status: "failed";
      readonly code: AgentChannelDeliveryFailureCode;
      readonly attempts: number;
      readonly error: unknown;
    };

interface LaneMaterial {
  readonly queue: SendJob[];
  running: boolean;
  current?: SendJob;
}

interface SendJob {
  readonly id: string;
  source: AgentChannelSource;
  content: string;
  options?: AgentChannelSendReplyOptions;
  attempt: number;
  retryAt?: number;
  sending?: boolean;
  readonly resolve: (receipt: AgentChannelDeliveryReceipt) => void;
}

/**
 * Per-lane delivery pump with durable payloads and platform receipts. Preserves message order inside one
 * conversation lane, retries transient platform failures with backoff, and
 * honors flood-control windows. Delivery failures beyond the configured
 * policy are surfaced through `onError`/`onDropped` instead of being silently
 * swallowed.
 */
export class AgentChannelDelivery {
  readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly laneQueueLimit: number;
  private readonly floodRetryMultiplierMs: number;
  private readonly lanes = new Map<string, LaneMaterial>();
  private stopped = false;
  private readonly inFlight = new Map<string, Promise<AgentChannelDeliveryReceipt>>();

  constructor(private readonly options: AgentChannelDeliveryOptions) {
    this.maxAttempts = positiveInteger(options.maxAttempts ?? AgentChannelDeliveryDefaults.maxAttempts, "maxAttempts");
    this.retryBaseDelayMs = positiveInteger(
      options.retryBaseDelayMs ?? AgentChannelDeliveryDefaults.retryBaseDelayMs,
      "retryBaseDelayMs",
    );
    this.retryMaxDelayMs = positiveInteger(
      options.retryMaxDelayMs ?? AgentChannelDeliveryDefaults.retryMaxDelayMs,
      "retryMaxDelayMs",
    );
    this.laneQueueLimit = positiveInteger(
      options.laneQueueLimit ?? AgentChannelDeliveryDefaults.laneQueueLimit,
      "laneQueueLimit",
    );
    this.floodRetryMultiplierMs = positiveInteger(
      options.floodRetryMultiplierMs ?? AgentChannelDeliveryDefaults.floodRetryMultiplierMs,
      "floodRetryMultiplierMs",
    );
  }

  /** Enqueues one send. Returns false when delivery is stopped or the lane is full. */
  enqueue(source: AgentChannelSource, content: string, options?: AgentChannelSendReplyOptions): boolean {
    const result = this.enqueueJob(source, content, options);
    void result.completion;
    return result.accepted;
  }

  /**
   * Enqueues a send and resolves only after the adapter accepted it or the
   * delivery policy gave up. Callers that own a user-facing activity should
   * use this method so a dropped upload cannot be reported as success.
   */
  enqueueAndWait(
    source: AgentChannelSource,
    content: string,
    options?: AgentChannelSendReplyOptions,
  ): Promise<AgentChannelDeliveryReceipt> {
    return this.enqueueJob(source, content, options).completion;
  }

  private enqueueJob(
    source: AgentChannelSource,
    content: string,
    options?: AgentChannelSendReplyOptions,
    recovered?: AgentChannelOutboxEntry,
  ): { accepted: boolean; completion: Promise<AgentChannelDeliveryReceipt> } {
    if (this.stopped) {
      return {
        accepted: false,
        completion: Promise.resolve({
          status: "failed",
          code: "stopped",
          attempts: 0,
          error: new Error("Delivery is stopped."),
        }),
      };
    }
    const laneId = laneKey(source);
    const lane = this.lanes.get(laneId) ?? { queue: [], running: false };
    const id = recovered?.id ?? options?.deliveryId ?? createOpaqueId("channel_delivery");
    const entry =
      recovered ?? this.options.outbox?.accept({ id, source, content, options, attempts: 0, state: "pending" });
    const existingPromise = this.inFlight.get(id);
    if (existingPromise) return { accepted: true, completion: existingPromise };
    if (entry?.state === "sending") {
      const receipt = {
        status: "failed",
        code: "delivery_unknown",
        attempts: entry.attempts,
        error: new Error("The previous send has no committed platform receipt."),
      } as const;
      this.options.outbox?.save({ ...entry, state: "uncertain", receipt });
      return { accepted: false, completion: Promise.resolve(receipt) };
    }
    if (entry?.receipt) return { accepted: entry.state === "sent", completion: Promise.resolve(entry.receipt) };
    if (lane.queue.length >= this.laneQueueLimit) {
      const error = new Error("Lane queue is full.");
      const receipt = { status: "failed", code: "queue_full", attempts: entry?.attempts ?? 0, error } as const;
      if (entry) this.options.outbox?.save({ ...entry, state: "failed", receipt });
      this.reportDropped(source, content, error, options);
      return { accepted: false, completion: Promise.resolve(receipt) };
    }
    let resolve: (receipt: AgentChannelDeliveryReceipt) => void = () => undefined;
    const completion = new Promise<AgentChannelDeliveryReceipt>((settle) => {
      resolve = settle;
    });
    this.inFlight.set(id, completion);
    this.lanes.set(laneId, lane);
    lane.queue.push({
      id,
      source,
      content,
      options,
      attempt: entry?.attempts ?? 0,
      retryAt: entry?.retryAt,
      resolve: (receipt) => {
        this.inFlight.delete(id);
        resolve(receipt);
      },
    });
    if (!lane.running) {
      lane.running = true;
      void this.pumpLane(laneId, lane);
    }
    return { accepted: true, completion };
  }

  async flush(): Promise<void> {
    while (this.hasPendingWork()) {
      await delay(10);
    }
  }

  /** Called only after the adapter reconnects and its permissions are known. */
  resume(): void {
    if (this.stopped || !this.options.outbox) return;
    try {
      for (const entry of this.options.outbox.recover(this.options.adapter.kind, new Set(this.inFlight.keys()))) {
        if (entry.state === "uncertain") {
          this.reportDropped(
            entry.source,
            entry.content,
            entry.receipt?.status === "failed" ? entry.receipt.error : undefined,
            entry.options,
          );
        } else {
          if (this.options.adapter.getConnectionState(entry.source) !== "connected") continue;
          if ((this.lanes.get(laneKey(entry.source))?.queue.length ?? 0) >= this.laneQueueLimit) continue;
          this.enqueueJob(entry.source, entry.content, entry.options, entry);
        }
      }
    } catch (error) {
      this.reportError(error);
    }
  }

  stop(): void {
    this.stopped = true;
    const error = new Error("Delivery is stopped.");
    for (const lane of this.lanes.values()) {
      for (const job of lane.queue) {
        job.resolve({ status: "failed", code: "stopped", attempts: job.attempt, error });
      }
      if (lane.current) {
        const job = lane.current;
        const receipt: AgentChannelDeliveryReceipt = {
          status: "failed",
          code: job.sending ? "delivery_unknown" : "stopped",
          attempts: job.attempt,
          error,
        };
        try {
          if (job.sending) this.persist(job, "uncertain", receipt);
        } catch (storageError) {
          this.reportError(storageError, job.source);
        } finally {
          job.resolve(receipt);
        }
      }
    }
    this.lanes.clear();
  }

  private hasPendingWork(): boolean {
    for (const lane of this.lanes.values()) {
      if (lane.running || lane.queue.length > 0) return true;
    }
    return false;
  }

  private async pumpLane(laneId: string, lane: LaneMaterial): Promise<void> {
    let storageHealthy = true;
    while (!this.stopped && lane.queue.length > 0) {
      const job = lane.queue.shift();
      if (!job) continue;
      lane.current = job;
      try {
        job.resolve(await this.deliver(job));
      } catch (error) {
        // Storage errors are not platform rejections. Leave durable state
        // intact and stop automatic refill so a broken DB cannot spin retries.
        storageHealthy = false;
        this.reportError(error, job.source);
        this.reportDropped(job.source, job.content, error, job.options);
        job.resolve({ status: "failed", code: "storage_failed", attempts: job.attempt, error });
      }
      lane.current = undefined;
    }
    lane.running = false;
    if (lane.queue.length === 0) this.lanes.delete(laneId);
    else if (!this.stopped) {
      lane.running = true;
      void this.pumpLane(laneId, lane);
    }
    if (!this.stopped && storageHealthy) this.resume();
  }

  private async deliver(job: SendJob): Promise<AgentChannelDeliveryReceipt> {
    if (job.retryAt && job.retryAt > Date.now()) await this.sleep(job.retryAt - Date.now());
    while (!this.stopped) {
      if (this.options.authorize?.(job.source) === false) {
        const receipt: AgentChannelDeliveryReceipt = {
          status: "failed",
          code: "revoked",
          attempts: job.attempt,
          error: new Error("Channel delivery permission was revoked."),
        };
        this.persist(job, "failed", receipt);
        return receipt;
      }
      job.attempt += 1;
      this.persist(job, "sending");
      let result: AgentChannelSendResult;
      try {
        job.sending = true;
        result = await this.options.adapter.send(job.source, job.content, job.options);
      } catch (error) {
        job.sending = false;
        if (isAgentChannelDeliveryUncertain(error)) {
          const receipt = { status: "failed", code: "delivery_unknown", attempts: job.attempt, error } as const;
          if (!this.stopped) this.persist(job, "uncertain", receipt);
          this.reportDropped(job.source, job.content, error, job.options);
          return receipt;
        }
        const retryDelay = this.resolveRetryDelay(error, job);
        if (retryDelay < 0) {
          this.reportDropped(job.source, job.content, error, job.options);
          const receipt = { status: "failed", code: "retry_exhausted", attempts: job.attempt, error } as const;
          if (!this.stopped) this.persist(job, "failed", receipt);
          return receipt;
        }
        job.retryAt = Date.now() + retryDelay;
        if (!this.stopped) this.persist(job, "pending");
        if (retryDelay > 0) await this.sleep(retryDelay);
        continue;
      }
      job.sending = false;
      // Receipt persistence errors must never retry an accepted platform send.
      if (result.kind === "sent" || result.kind === "edited") {
        const receipt = { status: "sent", messageId: result.messageId, attempts: job.attempt } as const;
        if (!this.stopped) this.persist(job, "sent", receipt);
        return receipt;
      }
      const error = new Error("Channel adapter does not support this delivery.");
      this.reportDropped(job.source, job.content, error, job.options);
      const receipt = { status: "failed", code: "unsupported", attempts: job.attempt, error } as const;
      if (!this.stopped) this.persist(job, "failed", receipt);
      return receipt;
    }
    return { status: "failed", code: "stopped", attempts: job.attempt, error: new Error("Delivery is stopped.") };
  }

  private persist(job: SendJob, state: AgentChannelOutboxEntry["state"], receipt?: AgentChannelDeliveryReceipt): void {
    this.options.outbox?.save({
      id: job.id,
      source: job.source,
      content: job.content,
      options: job.options,
      state,
      attempts: job.attempt,
      retryAt: job.retryAt,
      receipt,
    });
  }

  private resolveRetryDelay(error: unknown, job: SendJob): number {
    if (job.attempt >= this.maxAttempts) return -1;
    if (isNonRetryableError(error)) return -1;
    if (isFloodControlError(error)) {
      return floodRetryDelay(error, this.floodRetryMultiplierMs);
    }
    const base = this.retryBaseDelayMs * 2 ** (job.attempt - 1);
    return Math.min(base, this.retryMaxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)).unref?.());
  }

  private reportError(error: unknown, source?: AgentChannelSource): void {
    this.options.onError?.(error, source);
  }

  private reportDropped(
    source: AgentChannelSource,
    content: string,
    error: unknown,
    options?: AgentChannelSendReplyOptions,
  ): void {
    this.options.onDropped?.(content, source, error, options);
  }
}

/** Platform adapters can mark deterministic failures (for example QQ's
 * daily media quota) so the generic pump does not waste retries. */
export function isNonRetryableError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { retryable?: unknown }).retryable === false;
}

/** A transport interruption cannot tell us whether the remote side committed. */
export function isAgentChannelDeliveryUncertain(error: unknown): boolean {
  if (error instanceof AgentChannelHttpError) return error.status === 0;
  if (error instanceof TypeError) return true;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return (
    typeof code === "string" &&
    ["ECONNRESET", "ETIMEDOUT", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT"].includes(code)
  );
}

export function isFloodControlError(error: unknown): boolean {
  const typed = deliveryErrorRecord(error);
  if (!typed) return false;
  return (
    typed.channelErrorCode === "rate_limited" ||
    (typeof typed.floodRetryAfterSeconds === "number" && Number.isFinite(typed.floodRetryAfterSeconds))
  );
}

function floodRetryDelay(error: unknown, multiplierMs: number): number {
  const marker = deliveryErrorRecord(error)?.floodRetryAfterSeconds;
  const seconds = typeof marker === "number" && Number.isFinite(marker) ? marker : undefined;
  if (seconds !== undefined && seconds > 0) return seconds * multiplierMs;
  return multiplierMs;
}

function deliveryErrorRecord(
  error: unknown,
): { readonly channelErrorCode?: unknown; readonly floodRetryAfterSeconds?: unknown } | undefined {
  return typeof error === "object" && error !== null
    ? (error as { channelErrorCode?: unknown; floodRetryAfterSeconds?: unknown })
    : undefined;
}

function laneKey(source: AgentChannelSource): string {
  return serializeAgentChannelLane(source);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Marks an error as a flood-control event with the platform-provided window. */
export function createFloodError(
  message: string,
  retryAfterSeconds?: number,
): Error & { channelErrorCode: "rate_limited"; floodRetryAfterSeconds?: number } {
  const error = new Error(message) as Error & {
    channelErrorCode: "rate_limited";
    floodRetryAfterSeconds?: number;
  };
  error.channelErrorCode = "rate_limited";
  if (Number.isFinite(retryAfterSeconds)) error.floodRetryAfterSeconds = retryAfterSeconds;
  return error;
}

export function isAgentChannelSendResult(value: unknown): value is AgentChannelSendResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    ["sent", "edited", "deleted", "unsupported"].includes(String((value as { kind: unknown }).kind))
  );
}
