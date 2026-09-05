import { uniqueTrimmed } from "./AgentMemoryCollections.js";
import { buildEpisode } from "./AgentMemoryEpisodeRecords.js";
import { buildSources } from "./AgentMemorySourceRecords.js";
import type {
  AgentMemoryCompletedTurnInput,
  AgentMemoryDeletionImpact,
  AgentMemoryEpisodeRecord,
  AgentMemoryRecordedTurn,
  AgentMemorySourceRecord,
  AgentMemorySourceRepository,
} from "./AgentMemorySourceRepository.js";

export class InMemoryAgentMemorySourceRepository implements AgentMemorySourceRepository {
  private readonly episodes = new Map<string, AgentMemoryEpisodeRecord>();
  private readonly sourcesByEpisode = new Map<string, AgentMemorySourceRecord[]>();
  private catalogVersion = 0;

  catalogRevision(): string {
    return String(this.catalogVersion);
  }

  recordCompletedTurn(input: AgentMemoryCompletedTurnInput): AgentMemoryRecordedTurn {
    const episode = buildEpisode(input);
    const sources = buildSources(input, episode);
    this.episodes.set(episode.uri, episode);
    this.sourcesByEpisode.set(episode.uri, sources);
    this.catalogVersion += 1;
    return { episode, sources };
  }

  deleteSession(sessionId: string): AgentMemoryDeletionImpact {
    const episodeUris = [...this.episodes.values()]
      .filter((episode) => episode.sessionId === sessionId)
      .map((episode) => episode.uri);
    const sourceUris = episodeUris.flatMap((episodeUri) => this.listSources(episodeUri).map((source) => source.uri));
    for (const episode of this.episodes.values()) {
      if (episode.sessionId !== sessionId) continue;
      this.episodes.delete(episode.uri);
      this.sourcesByEpisode.delete(episode.uri);
    }
    if (episodeUris.length > 0) this.catalogVersion += 1;
    return { sessionId, scope: "session", episodeUris, sourceUris };
  }

  deleteFromSessionRequest(sessionId: string, requestId: string): AgentMemoryDeletionImpact {
    const target = [...this.episodes.values()].find(
      (episode) => episode.sessionId === sessionId && episode.requestId === requestId,
    );
    const episodes = target
      ? [...this.episodes.values()].filter(
          (episode) => episode.sessionId === sessionId && episode.startedAtMs >= target.startedAtMs,
        )
      : [...this.episodes.values()].filter(
          (episode) => episode.sessionId === sessionId && episode.requestId === requestId,
        );
    const episodeUris = episodes.map((episode) => episode.uri);
    const sourceUris = episodes.flatMap((episode) => this.listSources(episode.uri).map((source) => source.uri));
    for (const episode of episodes) {
      this.episodes.delete(episode.uri);
      this.sourcesByEpisode.delete(episode.uri);
    }
    if (episodeUris.length > 0) this.catalogVersion += 1;
    return {
      sessionId,
      scope: "from_request",
      requestId,
      requestIds: [...new Set(episodes.map((episode) => episode.requestId))],
      episodeUris,
      sourceUris,
    };
  }

  listEpisodes(sessionId: string): AgentMemoryEpisodeRecord[] {
    return [...this.episodes.values()]
      .filter((episode) => episode.sessionId === sessionId)
      .sort((left, right) => left.startedAtMs - right.startedAtMs || left.id.localeCompare(right.id));
  }

  listCompletedEpisodes(): AgentMemoryEpisodeRecord[] {
    return [...this.episodes.values()]
      .filter((episode) => episode.status === "completed")
      .sort((left, right) => right.completedAtMs - left.completedAtMs || left.id.localeCompare(right.id));
  }

  listCompletedEpisodesInRange(startMs: number, endMs: number): AgentMemoryEpisodeRecord[] {
    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs <= startMs) {
      throw new Error("Memory episode range must contain increasing safe integer timestamps.");
    }
    return [...this.episodes.values()]
      .filter(
        (episode) =>
          episode.status === "completed" && episode.completedAtMs >= startMs && episode.completedAtMs < endMs,
      )
      .sort((left, right) => left.completedAtMs - right.completedAtMs || left.id.localeCompare(right.id));
  }

  findEpisodesByUris(uris: readonly string[]): AgentMemoryEpisodeRecord[] {
    return uniqueTrimmed(uris).flatMap((uri) => {
      const episode = this.episodes.get(uri);
      return episode ? [episode] : [];
    });
  }

  listSources(episodeUri: string): AgentMemorySourceRecord[] {
    return [...(this.sourcesByEpisode.get(episodeUri) ?? [])];
  }

  listSourcesForEpisodes(episodeUris: readonly string[]): AgentMemorySourceRecord[] {
    const requested = new Set(uniqueTrimmed(episodeUris));
    return [...requested].flatMap((episodeUri) => this.listSources(episodeUri));
  }

  findMemorySourcesByRefs(refs: readonly string[]): AgentMemorySourceRecord[] {
    const requested = new Set(uniqueTrimmed(refs));
    return [...this.sourcesByEpisode.values()]
      .flat()
      .filter(
        (source) =>
          requested.has(source.uri) ||
          (source.evidenceUri !== "" && requested.has(source.evidenceUri)) ||
          (source.artifactUri !== "" && requested.has(source.artifactUri)),
      )
      .sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id));
  }

  close(): void {}
}
