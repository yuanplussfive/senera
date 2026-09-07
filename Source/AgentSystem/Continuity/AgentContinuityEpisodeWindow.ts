import type {
  AgentMemoryEpisodeRecord,
  AgentMemorySourceRecord,
  AgentMemorySourceRepository,
} from "../Memory/AgentMemorySourceRepository.js";

export interface AgentContinuityEpisodeWindowInput {
  readonly sourceRepository: AgentMemorySourceRepository;
  readonly anchorSources: readonly AgentMemorySourceRecord[];
  readonly before: number;
  readonly after: number;
}

export interface AgentContinuityEpisodeWindowEntry {
  readonly episode: AgentMemoryEpisodeRecord;
  readonly anchorSourceRefs: readonly string[];
  readonly sources: readonly AgentMemorySourceRecord[];
}

/**
 * Expands physical source matches into deterministic, turn-aligned history.
 * The model chooses the neighboring range; the host owns ordering, grouping,
 * and source integrity.
 */
export function buildAgentContinuityEpisodeWindow(
  input: AgentContinuityEpisodeWindowInput,
): AgentContinuityEpisodeWindowEntry[] {
  if (input.anchorSources.length === 0) return [];

  const anchorsByEpisode = groupAnchorsByEpisode(input.anchorSources);
  const selectedEpisodes = new Map<string, AgentMemoryEpisodeRecord>();
  for (const [sessionId, anchorEpisodeUris] of groupAnchorEpisodesBySession(input.anchorSources)) {
    const sessionEpisodes = input.sourceRepository.listEpisodes(sessionId);
    const episodeIndex = new Map(sessionEpisodes.map((episode, index) => [episode.uri, index]));
    for (const anchorEpisodeUri of anchorEpisodeUris) {
      const anchorIndex = episodeIndex.get(anchorEpisodeUri);
      if (anchorIndex === undefined) {
        throw new Error(`Memory source references an unknown episode: ${anchorEpisodeUri}`);
      }
      const start = Math.max(0, anchorIndex - input.before);
      const end = Math.min(sessionEpisodes.length, anchorIndex + input.after + 1);
      for (const episode of sessionEpisodes.slice(start, end)) {
        selectedEpisodes.set(episode.uri, episode);
      }
    }
  }

  const episodes = [...selectedEpisodes.values()].sort(compareEpisodes);
  const sourcesByEpisode = groupSourcesByEpisode(
    input.sourceRepository.listSourcesForEpisodes(episodes.map((episode) => episode.uri)),
  );
  return episodes.map((episode) => ({
    episode,
    anchorSourceRefs: anchorsByEpisode.get(episode.uri)?.map((source) => source.uri) ?? [],
    sources: sourcesByEpisode.get(episode.uri) ?? [],
  }));
}

function groupAnchorsByEpisode(
  sources: readonly AgentMemorySourceRecord[],
): ReadonlyMap<string, readonly AgentMemorySourceRecord[]> {
  const grouped = new Map<string, AgentMemorySourceRecord[]>();
  for (const source of sources) {
    const entries = grouped.get(source.episodeUri) ?? [];
    entries.push(source);
    grouped.set(source.episodeUri, entries);
  }
  return grouped;
}

function groupAnchorEpisodesBySession(
  sources: readonly AgentMemorySourceRecord[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const grouped = new Map<string, Set<string>>();
  for (const source of sources) {
    const episodeUris = grouped.get(source.sessionId) ?? new Set<string>();
    episodeUris.add(source.episodeUri);
    grouped.set(source.sessionId, episodeUris);
  }
  return grouped;
}

function groupSourcesByEpisode(
  sources: readonly AgentMemorySourceRecord[],
): ReadonlyMap<string, readonly AgentMemorySourceRecord[]> {
  const grouped = new Map<string, AgentMemorySourceRecord[]>();
  for (const source of sources) {
    const entries = grouped.get(source.episodeUri) ?? [];
    entries.push(source);
    grouped.set(source.episodeUri, entries);
  }
  for (const entries of grouped.values()) {
    entries.sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id));
  }
  return grouped;
}

function compareEpisodes(left: AgentMemoryEpisodeRecord, right: AgentMemoryEpisodeRecord): number {
  return (
    left.sessionId.localeCompare(right.sessionId) ||
    left.startedAtMs - right.startedAtMs ||
    left.id.localeCompare(right.id)
  );
}
