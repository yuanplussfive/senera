import path from "node:path";
import {
  AgentArtifactMemoryContentCache,
  type AgentArtifactMemoryContentCacheOptions,
} from "./AgentArtifactMemoryContentCache.js";

interface AgentArtifactMemoryContentCacheRegistryEntry {
  readonly cache: AgentArtifactMemoryContentCache;
  readonly fingerprint: string;
}

const DefaultMaxWorkspaceCaches = 8;

export class AgentArtifactMemoryContentCacheRegistry {
  private readonly entries = new Map<string, AgentArtifactMemoryContentCacheRegistryEntry>();

  constructor(private readonly maxWorkspaceCaches = DefaultMaxWorkspaceCaches) {}

  get(workspaceRoot: string, options: AgentArtifactMemoryContentCacheOptions): AgentArtifactMemoryContentCache {
    const key = path.resolve(workspaceRoot);
    const fingerprint = JSON.stringify([options.maxBytes, options.maxEntries]);
    const existing = this.entries.get(key);
    if (existing?.fingerprint === fingerprint) {
      this.touch(key, existing);
      return existing.cache;
    }

    existing?.cache.clear();
    const entry = {
      cache: new AgentArtifactMemoryContentCache(options),
      fingerprint,
    };
    this.entries.set(key, entry);
    this.evictOldest();
    return entry.cache;
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.cache.clear();
    this.entries.clear();
  }

  private touch(key: string, entry: AgentArtifactMemoryContentCacheRegistryEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private evictOldest(): void {
    while (this.entries.size > this.maxWorkspaceCaches) {
      const oldest = this.entries.entries().next().value as
        [string, AgentArtifactMemoryContentCacheRegistryEntry] | undefined;
      if (!oldest) return;
      oldest[1].cache.clear();
      this.entries.delete(oldest[0]);
    }
  }
}
