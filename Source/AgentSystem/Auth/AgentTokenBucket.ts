interface TokenBucketState {
  tokens: number;
  updatedAt: number;
}

export interface AgentTokenBucketResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export interface AgentTokenBucketOptions {
  readonly capacity: number;
  readonly refillPeriodMs: number;
  readonly maxEntries: number;
  readonly now?: () => number;
}

export class AgentTokenBucket {
  private readonly entries = new Map<string, TokenBucketState>();

  constructor(private readonly options: AgentTokenBucketOptions) {
    assertPositiveFinite(options.capacity, "capacity");
    assertPositiveFinite(options.refillPeriodMs, "refillPeriodMs");
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries <= 0) {
      throw new Error(`Token bucket maxEntries must be a positive safe integer: ${options.maxEntries}`);
    }
  }

  consume(key: string): AgentTokenBucketResult {
    const now = this.now();
    this.pruneRefilledEntries(now);
    const current = this.entries.get(key) ?? { tokens: this.options.capacity, updatedAt: now };
    const refillPerMs = this.options.capacity / this.options.refillPeriodMs;
    const tokens = Math.min(this.options.capacity, current.tokens + (now - current.updatedAt) * refillPerMs);
    const next = {
      tokens: tokens >= 1 ? tokens - 1 : 0,
      updatedAt: now,
    };

    this.ensureCapacity(key);
    this.entries.delete(key);
    this.entries.set(key, next);
    if (tokens >= 1) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000)),
    };
  }

  private ensureCapacity(incomingKey: string): void {
    if (this.entries.has(incomingKey) || this.entries.size < this.options.maxEntries) {
      return;
    }
    const oldestKey = this.entries.keys().next().value;
    if (oldestKey !== undefined) this.entries.delete(oldestKey);
  }

  private pruneRefilledEntries(now: number): void {
    const threshold = now - this.options.refillPeriodMs;
    for (const [key, state] of this.entries) {
      if (state.updatedAt > threshold) break;
      this.entries.delete(key);
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Token bucket ${name} must be positive and finite: ${value}`);
  }
}
