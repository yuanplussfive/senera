interface TokenBucketState {
  tokens: number;
  updatedAt: number;
}

export interface AgentTokenBucketResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export class AgentTokenBucket {
  private readonly entries = new Map<string, TokenBucketState>();

  constructor(
    private readonly options: {
      capacity: number;
      refillPeriodMs: number;
      maxEntries: number;
      now?: () => number;
    },
  ) {}

  consume(key: string): AgentTokenBucketResult {
    const now = this.now();
    const current = this.entries.get(key) ?? { tokens: this.options.capacity, updatedAt: now };
    const refillPerMs = this.options.capacity / this.options.refillPeriodMs;
    const tokens = Math.min(this.options.capacity, current.tokens + (now - current.updatedAt) * refillPerMs);
    const next = {
      tokens: tokens >= 1 ? tokens - 1 : 0,
      updatedAt: now,
    };

    this.ensureCapacity(key);
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
    const oldest = [...this.entries.entries()].sort(([, left], [, right]) => left.updatedAt - right.updatedAt)[0];
    if (oldest) {
      this.entries.delete(oldest[0]);
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
