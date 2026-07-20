import path from "node:path";
import { indexArtifactManifests } from "./AgentArtifactManifestIndex.js";
import type { ArtifactManifestRecord } from "./AgentArtifactMemoryTypes.js";

interface ArtifactManifestIndexCacheEntry {
  index?: ReadonlyMap<string, ArtifactManifestRecord>;
  refresh?: Promise<ReadonlyMap<string, ArtifactManifestRecord>>;
  lastUsed: number;
}

export class AgentArtifactManifestIndexCache {
  private readonly entries = new Map<string, ArtifactManifestIndexCacheEntry>();

  constructor(private readonly maxRoots = 8) {}

  async load(input: {
    artifactRoot: string;
    workspaceRoot: string;
    requiredArtifactIds: readonly string[];
  }): Promise<ReadonlyMap<string, ArtifactManifestRecord>> {
    const key = path.resolve(input.artifactRoot);
    const entry = this.entries.get(key) ?? { lastUsed: Date.now() };
    entry.lastUsed = Date.now();
    this.entries.set(key, entry);

    if (entry.index && input.requiredArtifactIds.every((artifactId) => entry.index?.has(artifactId))) {
      return entry.index;
    }

    entry.refresh ??= indexArtifactManifests(input.artifactRoot, input.workspaceRoot).then((index) => {
      entry.index = index;
      entry.refresh = undefined;
      entry.lastUsed = Date.now();
      this.evictInactiveRoots(key);
      return index;
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
