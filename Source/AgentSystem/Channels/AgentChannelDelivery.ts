import type {
  AgentChannelAdapter,
  AgentChannelSendResult,
  AgentChannelSource,
  AgentChannelSendReplyOptions,
} from "./AgentChannelTypes.js";

export const AgentChannelDeliveryDefaults = Object.freeze({
  /** Attempts per individual send before it is dropped and reported. */
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
  readonly maxAttempts?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly laneQueueLimit?: number;
  readonly floodRetryMultiplierMs?: number;
  readonly onError?: (error: unknown, source: AgentChannelSource) => void;
  readonly onDropped?: (
    content: string,
    source: AgentChannelSource,
    error: unknown,
    options?: AgentChannelSendReplyOptions,
  ) => void;
}

export type AgentChannelDeliveryFailureCode = "queue_full" | "stopped" | "unsupported" | "retry_exhausted";

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
}

interface SendJob {
  source: AgentChannelSource;
  content: string;
  options?: AgentChannelSendReplyOptions;
  attempt: number;
  readonly resolve: (receipt: AgentChannelDeliveryReceipt) => void;
}

/**
 * Per-lane in-memory delivery pump. Preserves message order inside one
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
    this.lanes.set(laneId, lane);
    if (lane.queue.length >= this.laneQueueLimit) {
      const error = new Error("Lane queue is full.");
      this.reportDropped(source, content, error, options);
      return {
        accepted: false,
        completion: Promise.resolve({ status: "failed", code: "queue_full", attempts: 0, error }),
      };
    }
    let resolve: (receipt: AgentChannelDeliveryReceipt) => void = () => undefined;
    const completion = new Promise<AgentChannelDeliveryReceipt>((settle) => {
      resolve = settle;
    });
    lane.queue.push({ source, content, options, attempt: 0, resolve });
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

  stop(): void {
    this.stopped = true;
    const error = new Error("Delivery is stopped.");
    for (const lane of this.lanes.values()) {
      for (const job of lane.queue) {
        job.resolve({ status: "failed", code: "stopped", attempts: job.attempt, error });
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
    while (!this.stopped && lane.queue.length > 0) {
      const job = lane.queue.shift();
      if (!job) continue;
      try {
        job.resolve(await this.deliver(job));
      } catch (error) {
        this.reportError(error, job.source);
        this.reportDropped(job.source, job.content, error, job.options);
        job.resolve({ status: "failed", code: "retry_exhausted", attempts: job.attempt + 1, error });
      }
    }
    lane.running = false;
    if (lane.queue.length === 0) this.lanes.delete(laneId);
    else if (!this.stopped) {
      lane.running = true;
      void this.pumpLane(laneId, lane);
    }
  }

  private async deliver(job: SendJob): Promise<AgentChannelDeliveryReceipt> {
    while (true) {
      try {
        // The lane accepts one send at a time; only the head job is attempted.
        const result = await this.options.adapter.send(job.source, job.content, job.options);
        if (result.kind === "sent" || result.kind === "edited") {
          return { status: "sent", messageId: result.messageId, attempts: job.attempt + 1 };
        }
        const error = new Error("Channel adapter does not support this delivery.");
        this.reportDropped(job.source, job.content, error, job.options);
        return { status: "failed", code: "unsupported", attempts: job.attempt + 1, error };
      } catch (error) {
        const retryDelay = this.resolveRetryDelay(error, job);
        if (retryDelay < 0) {
          this.reportDropped(job.source, job.content, error, job.options);
          return { status: "failed", code: "retry_exhausted", attempts: job.attempt + 1, error };
        }
        job.attempt += 1;
        if (retryDelay > 0) {
          await this.sleep(retryDelay);
        }
      }
    }
  }

  private resolveRetryDelay(error: unknown, job: SendJob): number {
    if (job.attempt + 1 >= this.maxAttempts) return -1;
    if (isNonRetryableError(error)) return -1;
    if (isFloodControlError(error)) {
      return floodRetryDelay(error, this.floodRetryMultiplierMs);
    }
    const base = this.retryBaseDelayMs * 2 ** job.attempt;
    return Math.min(base, this.retryMaxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)).unref?.());
  }

  private reportError(error: unknown, source?: AgentChannelSource): void {
    if (source) this.options.onError?.(error, source);
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
  return `${source.platform}/${source.chatId}/${source.threadId ?? ""}/${source.userId}`;
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
