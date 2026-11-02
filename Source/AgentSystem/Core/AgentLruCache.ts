export class AgentLruCache<TKey, TValue> extends Map<TKey, TValue> {
  private capacity: number;

  constructor(capacity: number) {
    super();
    this.capacity = requireCapacity(capacity);
  }

  override get(key: TKey): TValue | undefined {
    const value = super.get(key);
    if (value === undefined && !super.has(key)) return undefined;
    super.delete(key);
    super.set(key, value as TValue);
    return value;
  }

  override set(key: TKey, value: TValue): this {
    super.delete(key);
    super.set(key, value);
    this.evictOverflow();
    return this;
  }

  resize(capacity: number): void {
    this.capacity = requireCapacity(capacity);
    this.evictOverflow();
  }

  retain(keys: ReadonlySet<TKey>): void {
    for (const key of this.keys()) {
      if (!keys.has(key)) super.delete(key);
    }
  }

  private evictOverflow(): void {
    while (this.size > this.capacity) {
      const oldest = this.keys().next();
      if (oldest.done) return;
      super.delete(oldest.value);
    }
  }
}

function requireCapacity(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("LRU cache capacity must be a positive safe integer.");
  }
  return value;
}
