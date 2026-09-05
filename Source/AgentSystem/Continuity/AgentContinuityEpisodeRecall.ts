import type {
  AgentMemoryEpisodeRecord,
  AgentMemorySourceRecord,
  AgentMemorySourceRepository,
} from "../Memory/AgentMemorySourceRepository.js";
import type { AgentContinuityObservation, AgentContinuityScopeRef } from "./AgentContinuityDomain.js";
import { createAgentContinuityWatermark } from "./AgentContinuityWatermark.js";
import {
  agentContinuityObservationAuthority,
  agentContinuityObservationConfidence,
  agentContinuityObservationKind,
  agentContinuityObservationUri,
} from "./AgentContinuityObservationProjection.js";
import type { AgentContinuityIdentityContext } from "./AgentContinuityIdentityStore.js";
import { AgentLruCache } from "../Core/AgentLruCache.js";
import { AgentContinuityRecallIndexDefaults } from "./AgentContinuityRecallIndex.js";
import { readAgentMemorySourceText } from "../Memory/AgentMemorySourceText.js";

export interface AgentContinuityEpisodeRecallSnapshot {
  readonly revision: string;
  readonly observations: readonly AgentContinuityObservation[];
}

export const AgentContinuityEpisodeRecallModes = ["automatic", "explicit"] as const;
export type AgentContinuityEpisodeRecallMode = (typeof AgentContinuityEpisodeRecallModes)[number];

export interface AgentContinuityEpisodeRecallInput {
  readonly identity: AgentContinuityIdentityContext;
  readonly sessionId?: string;
  readonly range?: { readonly startMs: number; readonly endMs: number };
  /** Automatic prompt projection excludes the live session; explicit recall does not. */
  readonly mode?: AgentContinuityEpisodeRecallMode;
}

/**
 * Read-only projection of physical conversation evidence into the continuity
 * search surface. It never writes a learning record and never returns source
 * text to the prompt; callers receive source URIs and dereference them only
 * when the model explicitly asks for the evidence.
 */
export class AgentContinuityEpisodeRecall {
  private readonly snapshots = new AgentLruCache<string, AgentContinuityEpisodeRecallSnapshot>(
    AgentContinuityRecallIndexDefaults.snapshotEntries,
  );

  constructor(private readonly sourceRepository: AgentMemorySourceRepository) {}

  read(input: AgentContinuityEpisodeRecallInput): AgentContinuityEpisodeRecallSnapshot {
    const mode = input.mode ?? "explicit";
    const revision = this.sourceRepository.catalogRevision();
    const cacheKey = episodeRecallCacheKey(input, mode);
    const cached = this.snapshots.get(cacheKey);
    if (cached?.revision === revision) return cached;

    const episodes = (
      input.range
        ? this.sourceRepository.listCompletedEpisodesInRange(input.range.startMs, input.range.endMs)
        : this.sourceRepository.listCompletedEpisodes()
    ).filter((episode) => mode === "explicit" || episode.sessionId !== input.sessionId);
    const episodeUris = episodes.map((episode) => episode.uri);
    const sources = this.sourceRepository.listSourcesForEpisodes(episodeUris);

    const episodesByUri = new Map(episodes.map((episode) => [episode.uri, episode]));
    const observations = sources.flatMap((source) => {
      const episode = episodesByUri.get(source.episodeUri);
      const observation = episode ? projectSource(source, episode, input) : undefined;
      return observation ? [observation] : [];
    });

    const snapshot = { revision, observations } satisfies AgentContinuityEpisodeRecallSnapshot;
    this.snapshots.set(cacheKey, snapshot);
    return snapshot;
  }

  clear(input?: AgentContinuityEpisodeRecallInput): void {
    if (!input) {
      this.snapshots.clear();
      return;
    }
    if (input.mode) {
      this.snapshots.delete(episodeRecallCacheKey(input, input.mode));
      return;
    }
    for (const mode of AgentContinuityEpisodeRecallModes) {
      this.snapshots.delete(episodeRecallCacheKey(input, mode));
    }
  }
}

function episodeRecallCacheKey(
  input: AgentContinuityEpisodeRecallInput,
  mode: AgentContinuityEpisodeRecallMode,
): string {
  return JSON.stringify([
    input.identity.workspaceId,
    input.identity.userId ?? null,
    input.identity.worldId ?? null,
    input.sessionId ?? null,
    mode,
    input.range?.startMs ?? null,
    input.range?.endMs ?? null,
  ]);
}

function projectSource(
  source: AgentMemorySourceRecord,
  episode: AgentMemoryEpisodeRecord,
  input: AgentContinuityEpisodeRecallInput,
): AgentContinuityObservation | undefined {
  const scope =
    episode.sessionId === input.sessionId
      ? ({ kind: "session", id: episode.sessionId } satisfies AgentContinuityScopeRef)
      : ({ kind: "workspace", id: input.identity.workspaceId } satisfies AgentContinuityScopeRef);
  const summary = readAgentMemorySourceText(source, "summary_first");
  if (!summary) return undefined;
  const searchText = readAgentMemorySourceText(source);
  const authority = agentContinuityObservationAuthority(source.sourceKind);

  return {
    id: source.uri,
    uri: agentContinuityObservationUri(source.uri),
    kind: agentContinuityObservationKind(source.sourceKind),
    ...(searchText && searchText !== summary ? { searchText } : {}),
    summary,
    payload: {
      kind: "physical_source",
      sourceRef: source.uri,
      sourceKind: source.sourceKind,
      ...(source.toolName ? { toolName: source.toolName } : {}),
      ...(source.evidenceUri ? { evidenceUri: source.evidenceUri } : {}),
      ...(source.artifactUri ? { artifactUri: source.artifactUri } : {}),
      episodeUri: episode.uri,
      sessionId: episode.sessionId,
      requestId: episode.requestId,
      topic: episode.topic,
      localDate: episode.localDate,
      localHour: episode.localHour,
    },
    sourceRefs: [source.uri],
    watermark: createAgentContinuityWatermark(source.uri),
    scope,
    authority,
    confidence: agentContinuityObservationConfidence(source.sourceKind),
    occurredAt: source.createdAt,
    observedAt: source.updatedAt,
    createdAtMs: source.createdAtMs,
  };
}
