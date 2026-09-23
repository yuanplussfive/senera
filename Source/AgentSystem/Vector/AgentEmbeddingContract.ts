/**
 * Shared embedding contract consumed by every semantic-recall path (memory
 * continuity, ToolSearch capability index) and implemented by the local
 * bilingual encoder and, historically, remote HTTP embedding endpoints. Kept
 * transport-agnostic so any embedding source can be composed without coupling
 * to a specific client.
 */
export const AgentEmbeddingPriorities = {
  Foreground: "foreground",
  Background: "background",
} as const;

export type AgentEmbeddingPriority = (typeof AgentEmbeddingPriorities)[keyof typeof AgentEmbeddingPriorities];

export interface AgentEmbeddingRequest {
  input: readonly string[];
  /** Role marker aligning retrieval-side (query) and index-side (document)
   * embeddings. Explicit at every call site instead of inferred from batch
   * size, so single-item document batches cannot be mislabeled as queries. */
  role: "query" | "document";
  /**
   * Background derivation must yield to a user-facing semantic lookup when a
   * local embedding engine shares one execution lane. Implementations that do
   * not schedule work may safely ignore this hint.
   */
  priority?: AgentEmbeddingPriority;
  signal?: AbortSignal;
}

export interface AgentEmbeddingResult {
  model: string;
  vectors: number[][];
}
