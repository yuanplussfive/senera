import path from "node:path";
import {
  collectArtifactManifestFingerprints,
  indexArtifactManifestSnapshot,
  type ArtifactManifestFileFingerprint,
} from "./AgentArtifactManifestIndex.js";
import type { ArtifactManifestRecord } from "./AgentArtifactMemoryTypes.js";

interface ArtifactManifestIndexCacheEntry {
  index?: ReadonlyMap<string, ArtifactManifestRecord>;
  fingerprints?: ReadonlyMap<string, ArtifactManifestFileFingerprint>;
  refresh?: Promise<ReadonlyMap<string, ArtifactManifestRecord>>;
  lastUsed: number;
}

export class AgentArtifactManifestIndexCache {
  private readonly entries = new Map<string, ArtifactManifestIndexCacheEntry>();
  private readonly maxRoots: number;

  constructor(maxRoots = 8) {
    if (!Number.isSafeInteger(maxRoots) || maxRoots < 1) {
      throw new RangeError(`Artifact manifest cache maxRoots must be a positive safe integer: ${maxRoots}`);
    }
    this.maxRoots = maxRoots;
  }

  async load(input: {
    artifactRoot: string;
    workspaceRoot: string;
    requiredArtifactIds: readonly string[];
    refresh?: boolean;
  }): Promise<ReadonlyMap<string, ArtifactManifestRecord>> {
    const key = cacheKey(input.artifactRoot, input.workspaceRoot);
    const entry = this.entries.get(key) ?? { lastUsed: Date.now() };
    entry.lastUsed = Date.now();
    this.entries.set(key, entry);

    if (
      !input.refresh &&
      entry.index &&
      input.requiredArtifactIds.every((artifactId) => entry.index?.has(artifactId))
    ) {
      const currentFingerprints = await indexArtifactManifestFiles(input.artifactRoot, input.workspaceRoot);
      if (sameFingerprints(entry.fingerprints, currentFingerprints)) return entry.index;
    }

    entry.refresh ??= indexArtifactManifestSnapshot(input.artifactRoot, input.workspaceRoot).then((snapshot) => {
      entry.index = snapshot.index;
      entry.fingerprints = snapshot.fingerprints;
      entry.refresh = undefined;
      entry.lastUsed = Date.now();
      this.evictInactiveRoots(key);
      return snapshot.index;
    });

    try {
      return await entry.refresh;
    } catch (error) {
      entry.refresh = undefined;
      if (!entry.index) {
        this.entries.delete(key);
      }
      throw error;
    }
  }

  clear(): void {
    this.entries.clear();
  }

  private evictInactiveRoots(activeKey: string): void {
    if (this.entries.size <= this.maxRoots) {
      return;
    }
    const candidate = [...this.entries.entries()]
      .filter(([key, entry]) => key !== activeKey && !entry.refresh)
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed)
      .at(0);
    if (candidate) {
      this.entries.delete(candidate[0]);
    }
  }
}

function cacheKey(artifactRoot: string, workspaceRoot: string): string {
  return `${path.resolve(artifactRoot)}\u0000${path.resolve(workspaceRoot)}`;
}

async function indexArtifactManifestFiles(
  artifactRoot: string,
  workspaceRoot: string,
): Promise<ReadonlyMap<string, ArtifactManifestFileFingerprint>> {
  return collectArtifactManifestFingerprints(artifactRoot, workspaceRoot);
}

function sameFingerprints(
  left: ReadonlyMap<string, ArtifactManifestFileFingerprint> | undefined,
  right: ReadonlyMap<string, ArtifactManifestFileFingerprint>,
): boolean {
  if (!left || left.size !== right.size) return false;
  for (const [filePath, current] of right) {
    const previous = left.get(filePath);
    if (
      !previous ||
      previous.size !== current.size ||
      previous.mtimeMs !== current.mtimeMs ||
      previous.ctimeMs !== current.ctimeMs ||
      previous.ino !== current.ino
    ) {
      return false;
    }
  }
  return true;
}
