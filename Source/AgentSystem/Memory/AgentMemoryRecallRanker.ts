import MiniSearch from "minisearch";
import { resolveVectorModelsConfig } from "../AgentDefaults.js";
import { AgentToolSearchTokenizer } from "../ToolSearch/AgentToolSearchTokenizer.js";
import { AgentVectorModelClient } from "../Vector/AgentVectorModelClient.js";
import { cosineSimilarity } from "../Vector/AgentVectorSimilarity.js";
import type { AgentMemoryItemRecord, AgentMemorySourceRecord } from "./AgentMemorySourceRepository.js";
import { memoryItemRecallText } from "./AgentMemoryText.js";
import { ensureMemoryItemVectors } from "./AgentMemoryVectorIndex.js";
import {
  MemoryRecallPolicy,
  type MemoryRecallOptions,
  type MemoryRecallRankedEntry,
  type MemoryRecallRanking,
  type MemoryRecallScope,
} from "./AgentMemoryRecallTypes.js";
import { unique } from "./AgentMemoryRecallUtils.js";

interface MemoryRecallDocument {
  id: string;
  type: string;
  subject: string;
  claim: string;
  howToApply: string;
  tags: string;
  triggers: string;
}

export function scopedMemoryItems(
  items: readonly AgentMemoryItemRecord[],
  scope: MemoryRecallScope,
): AgentMemoryItemRecord[] {
  return scope === "all" ? [...items] : items.filter((item) => item.type === scope);
}

export function exactRefMemoryRanking(input: {
  refs: readonly string[];
  sources: readonly AgentMemorySourceRecord[];
  items: readonly AgentMemoryItemRecord[];
  directItems: readonly AgentMemoryItemRecord[];
}): MemoryRecallRankedEntry[] {
  const sourceRefs = new Set([...input.refs, ...input.sources.map((source) => source.uri)]);
  const directUris = new Set(input.directItems.map((item) => item.uri));
  return input.items
    .filter((item) => directUris.has(item.uri) || item.sourceRefs.some((sourceRef) => sourceRefs.has(sourceRef)))
    .map((item) => ({
      memoryUri: item.uri,
      score: 1,
    }));
}

export function keywordMemoryRanking(
  query: string,
  items: readonly AgentMemoryItemRecord[],
): MemoryRecallRankedEntry[] {
  if (items.length === 0) {
    return [];
  }

  const tokenizer = new AgentToolSearchTokenizer();
  const index = new MiniSearch<MemoryRecallDocument>({
    idField: "id",
    fields: ["type", "subject", "claim", "howToApply", "tags", "triggers"],
    storeFields: ["id"],
    tokenize: (text) => tokenizer.tokenize(text),
    processTerm: (term) => term,
  });
  index.addAll(items.map(memorySearchDocument));
  return index
    .search(query, {
      prefix: true,
      fuzzy: 0.2,
      combineWith: "OR",
    })
    .map((entry) => ({
      memoryUri: String(entry.id),
      score: entry.score,
    }));
}

export async function semanticMemoryRanking(
  query: string,
  items: readonly AgentMemoryItemRecord[],
  options: MemoryRecallOptions,
): Promise<MemoryRecallRankedEntry[]> {
  const vectorConfig = resolveVectorModelsConfig(options.config);
  if (!vectorConfig.Embedding.Enabled || items.length === 0) {
    return [];
  }

  const vectorClient = new AgentVectorModelClient(vectorConfig);
  await ensureMemoryItemVectors(vectorClient, options.repository, items, vectorConfig.Embedding.Model, options.signal);
  const vectors = new Map(
    options.repository.listMemoryItemVectors(vectorConfig.Embedding.Model).map((record) => [record.memoryUri, record]),
  );
  const queryEmbedding = (
    await vectorClient.embed({
      input: [query],
      signal: options.signal,
    })
  ).vectors[0];
  if (!queryEmbedding) {
    return [];
  }

  return items
    .flatMap((item) => {
      const vector = vectors.get(item.uri);
      return vector
        ? [
            {
              memoryUri: item.uri,
              score: cosineSimilarity(queryEmbedding, vector.embedding),
            },
          ]
        : [];
    })
    .sort((left, right) => right.score - left.score || left.memoryUri.localeCompare(right.memoryUri));
}

export async function rerankMemories(
  query: string,
  memoryUris: readonly string[],
  itemsByUri: ReadonlyMap<string, AgentMemoryItemRecord>,
  options: MemoryRecallOptions,
): Promise<MemoryRecallRankedEntry[]> {
  const vectorConfig = resolveVectorModelsConfig(options.config);
  if (!vectorConfig.Rerank.Enabled || memoryUris.length === 0) {
    return [];
  }

  const rerank = await new AgentVectorModelClient(vectorConfig).rerank({
    query,
    documents: memoryUris.flatMap((memoryUri) => {
      const item = itemsByUri.get(memoryUri);
      return item
        ? [
            {
              id: memoryUri,
              text: memoryItemRecallText(item),
            },
          ]
        : [];
    }),
    topK: memoryUris.length,
    signal: options.signal,
  });
  return rerank.results.map((entry) => ({
    memoryUri: entry.id,
    score: entry.score,
  }));
}

export function fuseMemoryRankings(
  rankings: readonly MemoryRecallRanking[],
  limit: number,
): Array<MemoryRecallRankedEntry & { matchedBy: string[] }> {
  const scores = new Map<
    string,
    {
      memoryUri: string;
      score: number;
      matchedBy: string[];
    }
  >();

  for (const ranking of rankings) {
    const seenInRanking = new Set<string>();
    ranking.entries.forEach((entry, index) => {
      if (seenInRanking.has(entry.memoryUri)) {
        return;
      }
      seenInRanking.add(entry.memoryUri);
      const current = scores.get(entry.memoryUri) ?? {
        memoryUri: entry.memoryUri,
        score: 0,
        matchedBy: [],
      };
      scores.set(entry.memoryUri, {
        memoryUri: entry.memoryUri,
        score: current.score + 1 / (MemoryRecallPolicy.rrfK + index + 1),
        matchedBy: unique([...current.matchedBy, ranking.name]),
      });
    });
  }

  return [...scores.values()]
    .sort(
      (left, right) =>
        exactRank(right) - exactRank(left) || right.score - left.score || left.memoryUri.localeCompare(right.memoryUri),
    )
    .slice(0, limit);
}

export function exactRank(entry: { matchedBy: readonly string[] }): number {
  return entry.matchedBy.includes("exact_ref") ? 1 : 0;
}

function memorySearchDocument(item: AgentMemoryItemRecord): MemoryRecallDocument {
  return {
    id: item.uri,
    type: item.type,
    subject: item.subject,
    claim: item.claim,
    howToApply: item.howToApply,
    tags: item.tags.join(" "),
    triggers: item.triggers.join(" "),
  };
}
