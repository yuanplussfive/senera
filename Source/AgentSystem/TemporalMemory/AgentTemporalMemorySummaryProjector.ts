import type { AgentMemorySourceRepository } from "../Memory/AgentMemorySourceRepository.js";
import { readAgentMemorySourceText } from "../Memory/AgentMemorySourceText.js";
import type { AgentTemporalMemorySqliteStore } from "./AgentTemporalMemorySqliteStore.js";
import type {
  AgentTemporalMemoryDigest,
  AgentTemporalMemorySummaryEntry,
  AgentTemporalMemorySummaryPromptInput,
} from "./AgentTemporalMemoryTypes.js";

export function projectAgentTemporalMemorySummaryInput(input: {
  readonly digest: AgentTemporalMemoryDigest;
  readonly store: AgentTemporalMemorySqliteStore;
  readonly sources: AgentMemorySourceRepository;
}): AgentTemporalMemorySummaryPromptInput {
  const members = input.store.members(input.digest.id);
  const entries =
    input.digest.granularity === "segment"
      ? projectEpisodeEntries(
          members.map((member) => member.memberUri),
          input.sources,
        )
      : projectDigestEntries(
          members.map((member) => member.memberUri),
          input.store,
        );
  if (entries.length === 0) throw new Error(`Temporal digest has no readable evidence: ${input.digest.uri}`);
  return {
    granularity: input.digest.granularity,
    periodStart: input.digest.periodStart,
    periodEnd: input.digest.periodEnd,
    timeZone: input.digest.timeZone,
    entries,
  };
}

function projectEpisodeEntries(
  episodeUris: readonly string[],
  sources: AgentMemorySourceRepository,
): AgentTemporalMemorySummaryEntry[] {
  const episodes = sources.findEpisodesByUris(episodeUris);
  const episodeByUri = new Map(episodes.map((episode) => [episode.uri, episode] as const));
  return sources
    .listSourcesForEpisodes(episodeUris)
    .filter((source) => source.sourceKind !== "artifact")
    .flatMap((source) => {
      const episode = episodeByUri.get(source.episodeUri);
      if (!episode) throw new Error(`Temporal digest source references an unknown episode: ${source.episodeUri}`);
      const summary = readAgentMemorySourceText(source, "summary_first");
      if (!summary) return [];
      const text = readAgentMemorySourceText(source);
      return {
        uri: source.uri,
        occurredAt: source.createdAt,
        kind: source.sourceKind,
        summary,
        ...(text && text !== summary ? { text } : {}),
        ...(source.toolName ? { toolName: source.toolName } : {}),
      };
    });
}

function projectDigestEntries(
  digestUris: readonly string[],
  store: AgentTemporalMemorySqliteStore,
): AgentTemporalMemorySummaryEntry[] {
  const digests = store.digestsByUris(digestUris);
  if (digests.some((digest) => digest.status !== "sealed")) {
    throw new Error("A calendar digest cannot summarize an unsealed child digest.");
  }
  return digests
    .sort((left, right) => left.periodStartMs - right.periodStartMs || left.id.localeCompare(right.id))
    .map((digest) => ({
      uri: digest.uri,
      occurredAt: digest.periodStart,
      kind: `${digest.granularity}_digest`,
      summary: digest.summary,
    }));
}
