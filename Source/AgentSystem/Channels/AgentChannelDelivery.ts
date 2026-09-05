import type {
  AgentChannelAdapter,
  AgentChannelSendResult,
  AgentChannelSource,
  AgentChannelSendReplyOptions,
} from "./AgentChannelTypes.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

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
  onDroppedMessagePrefix: agentErrorMessage("channels.delivery.droppedPrefix"),
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

interface LaneMaterial {
  readonly queue: SendJob[];
  running: boolean;
}

interface SendJob {
  source: AgentChannelSource;
  content: string;
  options?: AgentChannelSendReplyOptions;
  attempt: number;
  backoffUntil: number;
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

  /** Enqueues one send. Returns false when the lane queue is full. */
  enqueue(source: AgentChannelSource, content: string, options?: AgentChannelSendReplyOptions): boolean {
    if (this.stopped) return false;
    const laneId = laneKey(source);
    let lane = this.lanes.get(laneId);
    if (!lane) {
      lane = { queue: [], running: false };
      this.lanes.set(laneId, lane);
    }
    if (lane.queue.length >= this.laneQueueLimit) {
      this.reportDropped(source, content, new Error("Lane queue is full."), options);
      return false;
    }
    lane.queue.push({ source, content, options, attempt: 0, backoffUntil: 0 });
    if (!lane.running) {
      lane.running = true;
      void this.pumpLane(laneId, lane).catch(() => undefined);
    }
    return true;
  }

  async flush(): Promise<void> {
    while (this.hasPendingWork()) {
      await delay(10);
    }
  }

  stop(): void {
    this.stopped = true;
    this.lanes.clear();
  }

  private hasPendingWork(): boolean {
    for (const lane of this.lanes.values()) {
      if (lane.running || lane.queue.length > 0) return true;
    }
    return false;
  }

  private async pumpLane(laneId: string, lane: LaneMaterial): Promise<void> {
    try {
      while (!this.stopped && lane.queue.length > 0) {
        const job = lane.queue.shift();
        if (!job) break;
        if (job.backoffUntil > Date.now()) {
          await waitUntil(job.backoffUntil);
        }
        await this.deliver(job, lane);
      }
    } catch (error) {
      this.reportError(error, lane.queue[0]?.source);
    } finally {
      lane.running = false;
      if (lane.queue.length === 0) this.lanes.delete(laneId);
    }
  }

  private async deliver(job: SendJob, lane: LaneMaterial): Promise<void> {
    try {
      // The lane accepts one send at a time; only the head job is attempted.
      const result = await this.options.adapter.send(job.source, job.content, job.options);
      if (result.kind === "sent" || result.kind === "edited") return;
      // Unsupported sends are not retryable.
      return;
    } catch (error) {
      const retryDelay = this.resolveRetryDelay(error, job);
      if (retryDelay < 0) {
        this.reportDropped(job.source, job.content, error, job.options);
        return;
      }
      const due = Date.now() + retryDelay;
      job.attempt += 1;
      job.backoffUntil = due;
      lane.queue.unshift(job);
      if (retryDelay > 0) {
        await this.sleep(due - Date.now());
      }
    }
  }

  private resolveRetryDelay(error: unknown, job: SendJob): number {
    if (job.attempt >= this.maxAttempts) return -1;
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
  if (!(error instanceof Error)) return false;
  const marker = (error as { floodRetryAfterSeconds?: unknown }).floodRetryAfterSeconds;
  if (typeof marker === "number" && Number.isFinite(marker)) return true;
  return /flood|rate.?limit|too many requests|429/i.test(error.message);
}

function floodRetryDelay(error: unknown, multiplierMs: number): number {
  const marker = (error as { floodRetryAfterSeconds?: unknown }).floodRetryAfterSeconds;
  const seconds = typeof marker === "number" && Number.isFinite(marker) ? marker : undefined;
  if (seconds !== undefined && seconds > 0) return seconds * multiplierMs;
  return multiplierMs;
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

function waitUntil(millis: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, millis - Date.now()));
    timer.unref?.();
  });
}

/** Marks an error as a flood-control event with the platform-provided window. */
export function createFloodError(
  message: string,
  retryAfterSeconds?: number,
): Error & { floodRetryAfterSeconds?: number } {
  const error = new Error(message) as Error & { floodRetryAfterSeconds?: number };
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
