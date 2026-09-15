import type { AgentContinuityObservation, AgentContinuityScopeRef } from "./AgentContinuityDomain.js";
import type { AgentContinuitySqliteStore } from "./AgentContinuitySqliteStore.js";
import { agentContinuityScopeKey } from "./AgentContinuityScopes.js";
import type { AgentMemorySourceRepository } from "../Memory/AgentMemorySourceRepository.js";
import { AgentContinuityEpisodeRecall } from "./AgentContinuityEpisodeRecall.js";
import type { AgentContinuityIdentityContext } from "./AgentContinuityIdentityStore.js";
import { AgentLruCache } from "../Core/AgentLruCache.js";
import { AgentContinuityRecallIndexDefaults } from "./AgentContinuityRecallIndex.js";

export interface AgentContinuityRecallCatalogSnapshot {
  readonly scopeKey: string;
  /** Includes physical-history context so index caches cannot cross sessions. */
  readonly cacheKey: string;
  readonly revision: string;
  readonly observations: readonly AgentContinuityObservation[];
  readonly eventObservations: readonly AgentContinuityObservation[];
}

export interface AgentContinuityRecallCatalogReadOptions {
  readonly nowMs: number;
  readonly cacheTtlMs: number;
  readonly identity?: AgentContinuityIdentityContext;
  readonly sessionId?: string;
}

/** Shares one immutable observation catalog between prefetch and prompt compilation. */
export class AgentContinuityRecallCatalog {
  private readonly snapshots = new AgentLruCache<
    string,
    {
      readonly builtAtMs: number;
      readonly value: AgentContinuityRecallCatalogSnapshot;
    }
  >(AgentContinuityRecallIndexDefaults.snapshotEntries);

  private readonly episodeRecall?: AgentContinuityEpisodeRecall;

  constructor(
    private readonly store: AgentContinuitySqliteStore,
    sourceRepository?: AgentMemorySourceRepository,
  ) {
    this.episodeRecall = sourceRepository ? new AgentContinuityEpisodeRecall(sourceRepository) : undefined;
  }

  read(
    scopes: readonly AgentContinuityScopeRef[],
    options: AgentContinuityRecallCatalogReadOptions,
  ): AgentContinuityRecallCatalogSnapshot {
    const scopeKey = agentContinuityScopeKey(scopes);
    const cacheKey = agentContinuityRecallCatalogCacheKey(scopeKey, options);
    const physical =
      this.episodeRecall && options.identity
        ? this.episodeRecall.read({
            identity: options.identity,
            sessionId: options.sessionId,
            mode: "automatic",
          })
        : undefined;
    const revision = [this.store.recallCatalogRevision(scopes), physical?.revision ?? ""].join("\u0000");
    const cacheEnabled = options.cacheTtlMs > 0;
    this.removeExpired(options.nowMs, options.cacheTtlMs);
    const cached = this.snapshots.get(cacheKey);
    if (cacheEnabled && cached?.value.revision === revision && options.nowMs - cached.builtAtMs <= options.cacheTtlMs) {
      return cached.value;
    }

    const value: AgentContinuityRecallCatalogSnapshot = {
      scopeKey,
      cacheKey,
      revision,
      observations: this.store.listLearningObservations(scopes),
      eventObservations: mergeObservations([
        ...this.store.listEventObservations(scopes),
        ...(physical?.observations ?? []),
      ]),
    };
    if (cacheEnabled) this.snapshots.set(cacheKey, { builtAtMs: options.nowMs, value });
    return value;
  }

  clear(scopeKey?: string): void {
    if (scopeKey === undefined) {
      this.snapshots.clear();
      return;
    }
    for (const [cacheKey, snapshot] of this.snapshots) {
      if (snapshot.value.scopeKey === scopeKey) this.snapshots.delete(cacheKey);
    }
  }

  clearPhysical(input?: { readonly identity: AgentContinuityIdentityContext; readonly sessionId?: string }): void {
    this.episodeRecall?.clear(input);
  }

  private removeExpired(nowMs: number, cacheTtlMs: number): void {
    // A non-caching request is request-scoped; it must not evict a separately
    // warmed snapshot that can still serve a positive-TTL request.
    if (cacheTtlMs <= 0 || cacheTtlMs === Number.POSITIVE_INFINITY) return;
    for (const [cacheKey, snapshot] of this.snapshots) {
      if (nowMs - snapshot.builtAtMs > cacheTtlMs) this.snapshots.delete(cacheKey);
    }
  }
}

export function agentContinuityRecallCatalogCacheKey(
  scopeKey: string,
  options: Pick<AgentContinuityRecallCatalogReadOptions, "identity" | "sessionId">,
): string {
  return JSON.stringify([scopeKey, options.identity?.workspaceId ?? null, options.sessionId ?? null]);
}

function mergeObservations(observations: readonly AgentContinuityObservation[]): AgentContinuityObservation[] {
  const unique = new Map<string, AgentContinuityObservation>();
  for (const observation of observations) {
    const current = unique.get(observation.uri);
    if (!current || observation.scope.kind === "session") unique.set(observation.uri, observation);
  }
  return [...unique.values()];
}
