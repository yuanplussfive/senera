import fs from "node:fs";
import { readRegularFileSync, writeFileAtomicSync } from "../Core/AgentFs.js";

const CacheVersion = 1;
const CacheMaxBytes = 32 * 1024 * 1024;

export interface AgentCapabilityEmbeddingCacheStore {
  load(keys: ReadonlySet<string>): ReadonlyMap<string, readonly number[]>;
  replace(entries: ReadonlyMap<string, readonly number[]>): void;
}

interface PersistedEmbeddingCache {
  readonly version: number;
  readonly entries: Readonly<Record<string, readonly number[]>>;
}

/**
 * Workspace-scoped cache for derived capability vectors. The catalog and the
 * embedding identity remain authoritative; this file only avoids recomputing
 * vectors that can be deterministically derived again.
 */
export class AgentCapabilityEmbeddingFileStore implements AgentCapabilityEmbeddingCacheStore {
  constructor(
    private readonly filePath: string,
    private readonly onInvalid?: (error: unknown) => void,
  ) {}

  load(keys: ReadonlySet<string>): ReadonlyMap<string, readonly number[]> {
    if (keys.size === 0 || !fs.existsSync(this.filePath)) return new Map();

    let parsed: unknown;
    try {
      parsed = JSON.parse(
        readRegularFileSync(this.filePath, "ToolSearch embedding cache", { maxBytes: CacheMaxBytes }).toString("utf8"),
      );
    } catch (error) {
      this.onInvalid?.(error);
      return new Map();
    }

    if (!isPersistedEmbeddingCache(parsed)) {
      this.onInvalid?.(new Error("ToolSearch embedding cache has an unsupported format."));
      return new Map();
    }

    return new Map(
      Object.entries(parsed.entries).flatMap(([key, vector]) =>
        keys.has(key) && isEmbeddingVector(vector) ? [[key, vector] as const] : [],
      ),
    );
  }

  replace(entries: ReadonlyMap<string, readonly number[]>): void {
    const persisted: PersistedEmbeddingCache = {
      version: CacheVersion,
      entries: Object.fromEntries(
        [...entries.entries()].flatMap(([key, vector]) =>
          isEmbeddingVector(vector) ? [[key, [...vector]] as const] : [],
        ),
      ),
    };
    writeFileAtomicSync(this.filePath, `${JSON.stringify(persisted)}\n`, {
      mode: 0o600,
      directoryMode: 0o700,
    });
  }
}

function isPersistedEmbeddingCache(value: unknown): value is PersistedEmbeddingCache {
  if (!isRecord(value) || value.version !== CacheVersion || !isRecord(value.entries)) return false;
  return Object.values(value.entries).every(isEmbeddingVector);
}

function isEmbeddingVector(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
