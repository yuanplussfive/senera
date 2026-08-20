import MiniSearch from "minisearch";
import { resolveVectorModelsConfig } from "../AgentDefaults.js";
import { AgentToolSearchTokenizer } from "../ToolSearch/AgentToolSearchTokenizer.js";
import { AgentVectorModelClient } from "../Vector/AgentVectorModelClient.js";
import type { AgentMemoryEpisodeRecord, AgentMemorySourceRecord } from "./AgentMemorySourceRepository.js";
import { exactRank } from "./AgentMemoryRecallRanker.js";
import {
  MemoryRecallPolicy,
  type ConversationRecallRankedEntry,
  type ConversationRecallRanking,
  type MemoryRecallOptions,
  type MemoryRecallTurnEntry,
} from "./AgentMemoryRecallTypes.js";
import { projectConversationTurnResult } from "./AgentMemoryRecallProjector.js";
import { unique } from "./AgentMemoryRecallUtils.js";

interface ConversationRecallDocument {
  id: string;
  rawUserText: string;
  standaloneRequest: string;
  topic: string;
  summary: string;
  contextBasis: string;
}

export async function recallConversationTurns(input: {
  query: string;
  refs: readonly string[];
  limit: number;
  candidateLimit: number;
  exactSources: readonly AgentMemorySourceRecord[];
  options: MemoryRecallOptions;
}): Promise<MemoryRecallTurnEntry[]> {
  const episodes = input.options.repository.listCompletedEpisodes();
  const episodesByUri = new Map(episodes.map((episode) => [episode.uri, episode]));
  const initialRankings: ConversationRecallRanking[] = [
    {
      name: "exact_ref",
      entries: conversationExactRefRanking({
        refs: input.refs,
        sources: input.exactSources,
        episodes,
        directEpisodes: input.options.repository
          .findEpisodesByUris(input.refs)
          .filter((episode) => episodesByUri.has(episode.uri)),
      }),
    },
    {
      name: "keyword",
      entries: conversationKeywordRanking(input.query, episodes),
    },
  ];
  const candidateEpisodeUris = fuseConversationRankings(initialRankings, input.candidateLimit).map(
    (entry) => entry.episodeUri,
  );
  const reranked = await rerankConversationTurns(input.query, candidateEpisodeUris, episodesByUri, input.options);
  return fuseConversationRankings(
    [
      ...initialRankings,
      {
        name: "rerank",
        entries: reranked,
      },
    ],
    input.limit,
  ).flatMap((entry) => {
    const episode = episodesByUri.get(entry.episodeUri);
    return episode
      ? [projectConversationTurnResult(episode, input.options.repository.listSources(episode.uri), entry)]
      : [];
  });
}

function conversationExactRefRanking(input: {
  refs: readonly string[];
  sources: readonly AgentMemorySourceRecord[];
  episodes: readonly AgentMemoryEpisodeRecord[];
  directEpisodes: readonly AgentMemoryEpisodeRecord[];
}): ConversationRecallRankedEntry[] {
  const episodeUris = new Set([
    ...input.directEpisodes.map((episode) => episode.uri),
    ...input.sources.map((source) => source.episodeUri),
  ]);
  return input.episodes
    .filter((episode) => episodeUris.has(episode.uri))
    .map((episode) => ({
      episodeUri: episode.uri,
      score: 1,
    }));
}

function conversationKeywordRanking(
  query: string,
  episodes: readonly AgentMemoryEpisodeRecord[],
): ConversationRecallRankedEntry[] {
  if (episodes.length === 0) {
    return [];
  }

  const tokenizer = new AgentToolSearchTokenizer();
  const index = new MiniSearch<ConversationRecallDocument>({
    idField: "id",
    fields: ["rawUserText", "standaloneRequest", "topic", "summary", "contextBasis"],
    storeFields: ["id"],
    tokenize: (text) => tokenizer.tokenize(text),
    processTerm: (term) => term,
  });
  index.addAll(episodes.map(conversationSearchDocument));
  return index
    .search(query, {
      prefix: true,
      fuzzy: 0.2,
      combineWith: "OR",
    })
    .map((entry) => ({
      episodeUri: String(entry.id),
      score: entry.score,
    }));
}

async function rerankConversationTurns(
  query: string,
  episodeUris: readonly string[],
  episodesByUri: ReadonlyMap<string, AgentMemoryEpisodeRecord>,
  options: MemoryRecallOptions,
): Promise<ConversationRecallRankedEntry[]> {
  const vectorConfig = resolveVectorModelsConfig(options.config);
  if (!vectorConfig.Rerank.Enabled || episodeUris.length === 0) {
    return [];
  }

  const rerank = await new AgentVectorModelClient(vectorConfig).rerank({
    query,
    documents: episodeUris.flatMap((episodeUri) => {
      const episode = episodesByUri.get(episodeUri);
      return episode
        ? [
            {
              id: episodeUri,
              text: conversationTurnRecallText(episode),
            },
          ]
        : [];
    }),
    topK: episodeUris.length,
    signal: options.signal,
  });
  return rerank.results.map((entry) => ({
    episodeUri: entry.id,
    score: entry.score,
  }));
}

function fuseConversationRankings(
  rankings: readonly ConversationRecallRanking[],
  limit: number,
): Array<ConversationRecallRankedEntry & { matchedBy: string[] }> {
  const scores = new Map<
    string,
    {
      episodeUri: string;
      score: number;
      matchedBy: string[];
    }
  >();

  for (const ranking of rankings) {
    const seenInRanking = new Set<string>();
    ranking.entries.forEach((entry, index) => {
      if (seenInRanking.has(entry.episodeUri)) {
        return;
      }
      seenInRanking.add(entry.episodeUri);
      const current = scores.get(entry.episodeUri) ?? {
        episodeUri: entry.episodeUri,
        score: 0,
        matchedBy: [],
      };
      scores.set(entry.episodeUri, {
        episodeUri: entry.episodeUri,
        score: current.score + 1 / (MemoryRecallPolicy.rrfK + index + 1),
        matchedBy: unique([...current.matchedBy, ranking.name]),
      });
    });
  }

  return [...scores.values()]
    .sort(
      (left, right) =>
        exactRank(right) - exactRank(left) ||
        right.score - left.score ||
        left.episodeUri.localeCompare(right.episodeUri),
    )
    .slice(0, limit);
}

function conversationSearchDocument(episode: AgentMemoryEpisodeRecord): ConversationRecallDocument {
  return {
    id: episode.uri,
    rawUserText: episode.rawUserText,
    standaloneRequest: episode.standaloneRequest,
    topic: episode.topic,
    summary: episode.summary,
    contextBasis: episode.contextBasis,
  };
}

function conversationTurnRecallText(episode: AgentMemoryEpisodeRecord): string {
  return [episode.rawUserText, episode.standaloneRequest, episode.topic, episode.summary, episode.contextBasis].join(
    "\n",
  );
}
