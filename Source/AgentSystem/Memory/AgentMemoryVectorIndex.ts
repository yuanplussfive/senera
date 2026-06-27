import { cosineSimilarity } from "../Vector/AgentVectorSimilarity.js";
import type { AgentVectorModelClient } from "../Vector/AgentVectorModelClient.js";
import type {
  AgentMemoryItemRecord,
  AgentMemoryItemVectorWrite,
  AgentMemorySourceRepository,
} from "./AgentMemorySourceRepository.js";
import {
  memoryItemEmbeddingText,
  memoryItemRecallText,
} from "./AgentMemoryText.js";

export interface AgentMemorySimilarityQuery {
  text: string;
  items: readonly AgentMemoryItemRecord[];
  model: string;
  limit: number;
  minSimilarity: number;
  signal?: AbortSignal;
}

export interface AgentMemorySimilarityResult {
  item: AgentMemoryItemRecord;
  score: number;
}

export async function rankSimilarMemoryItems(
  vectorClient: AgentVectorModelClient,
  repository: AgentMemorySourceRepository,
  query: AgentMemorySimilarityQuery,
): Promise<AgentMemorySimilarityResult[]> {
  if (query.items.length === 0) {
    return [];
  }

  await ensureMemoryItemVectors(
    vectorClient,
    repository,
    query.items,
    query.model,
    query.signal,
  );

  const vectors = new Map(
    repository.listMemoryItemVectors(query.model)
      .map((record) => [record.memoryUri, record]),
  );
  const queryEmbedding = (await vectorClient.embed({
    input: [query.text],
    signal: query.signal,
  })).vectors[0];
  if (!queryEmbedding) {
    return [];
  }

  const byUri = new Map(query.items.map((item) => [item.uri, item]));
  const semanticRanked = query.items.flatMap((item) => {
    const vector = vectors.get(item.uri);
    return vector ? [{
      item,
      score: cosineSimilarity(queryEmbedding, vector.embedding),
    }] : [];
  }).filter((entry) => entry.score >= query.minSimilarity)
    .sort((left, right) => right.score - left.score || left.item.uri.localeCompare(right.item.uri))
    .slice(0, query.limit);

  const reranked = await vectorClient.rerank({
    query: query.text,
    documents: semanticRanked.map(({ item }) => ({
      id: item.uri,
      text: memoryItemRecallText(item),
    })),
    topK: query.limit,
    signal: query.signal,
  });

  if (reranked.results.length === 0) {
    return semanticRanked;
  }

  return reranked.results.flatMap((result) => {
    const item = byUri.get(result.id);
    return item ? [{
      item,
      score: result.score,
    }] : [];
  });
}

export async function ensureMemoryItemVectors(
  vectorClient: AgentVectorModelClient,
  repository: AgentMemorySourceRepository,
  items: readonly AgentMemoryItemRecord[],
  model: string,
  signal?: AbortSignal,
): Promise<void> {
  const existing = new Set(repository.listMemoryItemVectors(model).map((record) => record.memoryUri));
  const missing = items.filter((item) => !existing.has(item.uri));
  if (missing.length === 0) {
    return;
  }

  const result = await vectorClient.embed({
    input: missing.map(memoryItemEmbeddingText),
    signal,
  });
  repository.upsertMemoryItemVectors(missing.flatMap((item, index) =>
    memoryItemVectorWrite(item, result.model, result.vectors[index])));
}

function memoryItemVectorWrite(
  item: AgentMemoryItemRecord,
  model: string,
  embedding: number[] | undefined,
): AgentMemoryItemVectorWrite[] {
  return embedding ? [{
    memoryUri: item.uri,
    model,
    embedding,
    updatedAt: item.updatedAt,
  }] : [];
}
