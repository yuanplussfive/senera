import type { ResolvedAgentMemoryLearningConfig } from "../Types/AgentConfigTypes.js";
import type {
  AgentEmbeddingRequest,
  AgentEmbeddingResult,
  AgentRerankRequest,
  AgentRerankResult,
} from "../Vector/AgentVectorModelClient.js";
import { cosineSimilarity } from "../Vector/AgentVectorSimilarity.js";
import {
  type AgentMemoryCandidateDraft,
  type AgentMemoryCandidateRecord,
  type AgentMemoryItemRecord,
  type AgentMemorySourceRepository,
} from "./AgentMemorySourceRepository.js";
import { memoryCandidateEmbeddingText, memoryItemEmbeddingText } from "./AgentMemoryText.js";

export interface AgentMemoryLearningVectorClient {
  embed(request: AgentEmbeddingRequest): Promise<AgentEmbeddingResult>;
  rerank(request: AgentRerankRequest): Promise<AgentRerankResult>;
}

export async function withMemoryCandidateEmbeddings(
  vectorClient: AgentMemoryLearningVectorClient,
  candidates: readonly AgentMemoryCandidateDraft[],
): Promise<AgentMemoryCandidateDraft[]> {
  const result = await vectorClient.embed({
    input: candidates.map(memoryCandidateEmbeddingText),
  });
  return candidates.map((candidate, index) => ({
    ...candidate,
    embedding: result.vectors[index],
  }));
}

export async function recordMemoryItemEmbeddings(
  vectorClient: AgentMemoryLearningVectorClient,
  repository: AgentMemorySourceRepository,
  items: readonly AgentMemoryItemRecord[],
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const result = await vectorClient.embed({
    input: items.map(memoryItemEmbeddingText),
  });
  repository.upsertMemoryItemVectors(
    items.flatMap((item, index) => {
      const embedding = result.vectors[index];
      return embedding
        ? [
            {
              memoryUri: item.uri,
              model: result.model,
              embedding,
              updatedAt: item.updatedAt,
            },
          ]
        : [];
    }),
  );
}

export async function rankSimilarPendingCandidates(
  vectorClient: AgentMemoryLearningVectorClient,
  config: ResolvedAgentMemoryLearningConfig,
  target: AgentMemoryCandidateRecord,
  pending: readonly AgentMemoryCandidateRecord[],
): Promise<AgentMemoryCandidateRecord[]> {
  const embeddingRanked = pending
    .map((candidate) => ({
      candidate,
      score: memoryCandidateSimilarity(target, candidate),
    }))
    .filter((item) => item.score >= config.Promotion.MinSimilarity)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.createdAtMs - right.candidate.createdAtMs ||
        left.candidate.id.localeCompare(right.candidate.id),
    )
    .slice(0, config.Promotion.MaxClusterSize)
    .map((item) => item.candidate);

  const reranked = await vectorClient.rerank({
    query: memoryCandidateEmbeddingText(target),
    documents: embeddingRanked.map((candidate) => ({
      id: candidate.uri,
      text: memoryCandidateEmbeddingText(candidate),
    })),
    topK: config.Promotion.MaxClusterSize,
  });

  if (reranked.results.length === 0) {
    return embeddingRanked;
  }

  const byUri = new Map(embeddingRanked.map((candidate) => [candidate.uri, candidate]));
  return reranked.results
    .map((item) => byUri.get(item.id))
    .filter((candidate): candidate is AgentMemoryCandidateRecord => Boolean(candidate));
}

function memoryCandidateSimilarity(left: AgentMemoryCandidateRecord, right: AgentMemoryCandidateRecord): number {
  if (left.uri === right.uri) {
    return 1;
  }
  if (left.embedding && right.embedding) {
    return cosineSimilarity(left.embedding, right.embedding);
  }
  return left.subject === right.subject && left.claim === right.claim ? 1 : 0;
}
