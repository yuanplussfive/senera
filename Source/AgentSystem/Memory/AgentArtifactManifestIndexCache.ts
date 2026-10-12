import path from "node:path";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { normalizeAgentResourceUri } from "../Resources/AgentResourceUri.js";
import { AgentArtifactManifestSqliteStore, type IndexedManifestAsset } from "./AgentArtifactManifestSqliteStore.js";
import type { ArtifactManifestRecord } from "./AgentArtifactMemoryTypes.js";

interface ArtifactManifestIndexCacheEntry {
  readonly store: AgentArtifactManifestSqliteStore;
  refresh?: Promise<void>;
  activeUsers: number;
}

export class AgentArtifactManifestIndexCache {
  private readonly entries = new Map<string, ArtifactManifestIndexCacheEntry>();
  constructor(private readonly databasePath?: string) {}

  async load(input: {
    artifactRoot: string;
    workspaceRoot: string;
    requiredArtifactIds: readonly string[];
    refresh?: boolean;
  }): Promise<ReadonlyMap<string, ArtifactManifestRecord>> {
    const entry = this.getEntry(input.artifactRoot, input.workspaceRoot);
    try {
      const artifactIds = uniqueIds(input.requiredArtifactIds);
      if (artifactIds.length === 0) return new Map();
      if (input.refresh) {
        await this.synchronize(entry, input.artifactRoot, input.workspaceRoot);
      }

      let manifests = await entry.store.loadManifests(input.artifactRoot, input.workspaceRoot, artifactIds);
      if (artifactIds.some((artifactId) => !manifests.has(artifactId))) {
        await this.synchronize(entry, input.artifactRoot, input.workspaceRoot);
        manifests = await entry.store.loadManifests(input.artifactRoot, input.workspaceRoot, artifactIds);
      }
      return manifests;
    } finally {
      this.releaseEntry(input.artifactRoot, input.workspaceRoot, entry);
    }
  }

  async resolveAsset(input: {
    artifactRoot: string;
    workspaceRoot: string;
    resourceUri: string;
    refresh?: boolean;
  }): Promise<IndexedManifestAsset | undefined> {
    const entry = this.getEntry(input.artifactRoot, input.workspaceRoot);
    try {
      if (input.refresh) await this.synchronize(entry, input.artifactRoot, input.workspaceRoot);
      const resourceUri = normalizeAgentResourceUri(input.resourceUri);
      if (!resourceUri) return undefined;
      let asset = entry.store.findAsset(input.artifactRoot, resourceUri);
      if (asset && !(await entry.store.isManifestCurrent(input.artifactRoot, asset))) {
        await this.synchronize(entry, input.artifactRoot, input.workspaceRoot);
        asset = entry.store.findAsset(input.artifactRoot, resourceUri);
      }
      if (!asset) {
        await this.synchronize(entry, input.artifactRoot, input.workspaceRoot);
        asset = entry.store.findAsset(input.artifactRoot, resourceUri);
      }
      return asset;
    } finally {
      this.releaseEntry(input.artifactRoot, input.workspaceRoot, entry);
    }
  }

  async findCheckpoint(input: {
    artifactRoot: string;
    workspaceRoot: string;
    artifactId?: string;
    checkpointId?: string;
    refresh?: boolean;
  }): Promise<{ artifactId: string; manifestPath: string; relativeDir: string } | undefined> {
    const entry = this.getEntry(input.artifactRoot, input.workspaceRoot);
    try {
      if (input.refresh) await this.synchronize(entry, input.artifactRoot, input.workspaceRoot);
      let checkpoint = entry.store.findCheckpoint(input.artifactRoot, input);
      if (!checkpoint) {
        await this.synchronize(entry, input.artifactRoot, input.workspaceRoot);
        checkpoint = entry.store.findCheckpoint(input.artifactRoot, input);
      }
      return checkpoint;
    } finally {
      this.releaseEntry(input.artifactRoot, input.workspaceRoot, entry);
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.store.close();
    this.entries.clear();
  }

  private getEntry(artifactRoot: string, workspaceRoot: string): ArtifactManifestIndexCacheEntry {
    const key = cacheKey(artifactRoot, workspaceRoot);
    const existing = this.entries.get(key);
    if (existing) {
      existing.activeUsers += 1;
      return existing;
    }
    const layout = resolveAgentWorkspaceLayout(workspaceRoot);
    const entry: ArtifactManifestIndexCacheEntry = {
      store: new AgentArtifactManifestSqliteStore(this.databasePath ?? layout.databases.artifactManifestIndex),
      activeUsers: 1,
    };
    this.entries.set(key, entry);
    return entry;
  }

  private async synchronize(
    entry: ArtifactManifestIndexCacheEntry,
    artifactRoot: string,
    workspaceRoot: string,
  ): Promise<void> {
    entry.refresh ??= entry.store.synchronize(artifactRoot, workspaceRoot).finally(() => {
      entry.refresh = undefined;
    });
    await entry.refresh;
  }

  private releaseEntry(artifactRoot: string, workspaceRoot: string, entry: ArtifactManifestIndexCacheEntry): void {
    entry.activeUsers -= 1;
    if (entry.activeUsers !== 0 || entry.refresh) return;
    entry.store.close();
    this.entries.delete(cacheKey(artifactRoot, workspaceRoot));
  }
}

function cacheKey(artifactRoot: string, workspaceRoot: string): string {
  return `${path.resolve(artifactRoot)}\u0000${path.resolve(workspaceRoot)}`;
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}
