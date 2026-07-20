export interface CachedArtifactMemoryContent {
  content: string;
  byteLength: number;
}

export interface AgentArtifactMemoryContentCacheOptions {
  maxBytes: number;
  maxEntries: number;
}

interface AgentArtifactMemoryContentCacheEntry {
  readonly promise: Promise<CachedArtifactMemoryContent | undefined>;
  byteLength: number;
}

export class AgentArtifactMemoryContentCache {
  private readonly entries = new Map<string, AgentArtifactMemoryContentCacheEntry>();
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  private retainedBytes = 0;

  constructor(options: AgentArtifactMemoryContentCacheOptions) {
    this.maxBytes = normalizeLimit(options.maxBytes);
    this.maxEntries = normalizeLimit(options.maxEntries);
  }

  load(
    key: string,
    loader: () => Promise<CachedArtifactMemoryContent | undefined>,
  ): Promise<CachedArtifactMemoryContent | undefined> {
    const existing = this.entries.get(key);
    if (existing) {
      this.touch(key, existing);
      return existing.promise;
    }

    const entry: AgentArtifactMemoryContentCacheEntry = {
      promise: Promise.resolve().then(loader),
      byteLength: 0,
    };
    this.entries.set(key, entry);
    void entry.promise.then(
      (value) => this.recordLoadedSize(key, entry, value?.byteLength ?? 0),
      () => this.remove(key, entry),
    );
    this.evictOldest();
    return entry.promise;
  }

  clear(): void {
    this.entries.clear();
    this.retainedBytes = 0;
  }

  private touch(key: string, value: AgentArtifactMemoryContentCacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, value);
  }

  private recordLoadedSize(key: string, entry: AgentArtifactMemoryContentCacheEntry, byteLength: number): void {
    if (this.entries.get(key) !== entry) return;
    this.retainedBytes -= entry.byteLength;
    entry.byteLength = Math.max(0, byteLength);
    this.retainedBytes += entry.byteLength;
    this.evictOldest();
  }

  private evictOldest(): void {
    while (this.entries.size > this.maxEntries || this.retainedBytes > this.maxBytes) {
      const oldest = this.entries.entries().next().value as [string, AgentArtifactMemoryContentCacheEntry] | undefined;
      if (!oldest) return;
      this.remove(oldest[0], oldest[1]);
    }
  }

  private remove(key: string, entry: AgentArtifactMemoryContentCacheEntry): void {
    if (this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    this.retainedBytes = Math.max(0, this.retainedBytes - entry.byteLength);
  }
}

function normalizeLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
