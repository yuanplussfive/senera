import { cosineSimilarity } from "../Vector/AgentVectorSimilarity.js";
import type { AgentEmbeddingRequest, AgentEmbeddingResult } from "../Vector/AgentVectorModelClient.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentContinuitySqliteStore } from "./AgentContinuitySqliteStore.js";
import {
  agentContinuityEmbeddingTextSha256,
  type AgentContinuityObservationEmbedding,
} from "./AgentContinuitySqliteEmbeddings.js";
import {
  projectAgentContinuitySemanticDocument,
  uniqueAgentContinuitySemanticDocuments,
  type AgentContinuitySemanticDocument,
} from "./AgentContinuitySemanticDocument.js";

/** Minimal embedding surface so the shared vector model client can be injected without coupling. */
export interface AgentContinuitySemanticEmbeddingClient {
  embed(request: AgentEmbeddingRequest): Promise<AgentEmbeddingResult>;
}

export interface AgentContinuitySemanticRecallOptions {
  readonly store: AgentContinuitySqliteStore;
  readonly client?: AgentContinuitySemanticEmbeddingClient;
  /** Current embedding model id; rows persisted for other models are ignored. */
  readonly model: () => string;
  /** Semantic evidence below this cosine similarity contributes nothing. */
  readonly scoreFloor: () => number;
  readonly logger?: AgentLogger;
  readonly now?: () => Date;
}

export const AgentContinuitySemanticRecallStatuses = {
  ShortQuery: "short_query",
  NoObservations: "no_observations",
  NoClient: "no_client",
  NoEmbeddings: "no_embeddings",
  ModelMismatch: "model_mismatch",
  NoVector: "no_vector",
  DimensionMismatch: "dimension_mismatch",
  RequestFailed: "request_failed",
  Completed: "completed",
} as const;

export type AgentContinuitySemanticRecallStatus =
  (typeof AgentContinuitySemanticRecallStatuses)[keyof typeof AgentContinuitySemanticRecallStatuses];

export interface AgentContinuitySemanticRecallResult {
  readonly status: AgentContinuitySemanticRecallStatus;
  readonly scores: ReadonlyMap<string, number>;
  readonly indexedCount: number;
  readonly compatibleCount: number;
}

/**
 * Write-time document embeddings plus read-time cosine scoring. Every failure
 * path degrades to "no semantic evidence" so recall always completes on the
 * lexical channel alone.
 */
export class AgentContinuitySemanticRecall {
  private writeFailureReported = false;
  private readFailureReported = false;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: AgentContinuitySemanticRecallOptions) {}

  /** Persists embeddings for newly available semantic documents. */
  async embedDocuments(documents: readonly AgentContinuitySemanticDocument[]): Promise<number> {
    const uniqueDocuments = uniqueAgentContinuitySemanticDocuments(documents);
    if (uniqueDocuments.length === 0) return 0;
    const work = this.writeTail.then(() => this.embedDocumentsNow(uniqueDocuments));
    this.writeTail = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }

  /** Waits for queued write-time indexing before the database is closed. */
  async flush(): Promise<void> {
    await this.writeTail;
  }

  private async embedDocumentsNow(documents: readonly AgentContinuitySemanticDocument[]): Promise<number> {
    const client = this.options.client;
    if (!client || documents.length === 0) return 0;
    const model = this.options.model();
    try {
      const existing = this.options.store.listObservationEmbeddings(documents.map((document) => document.uri));
      const pending = documents.filter((document) => {
        const current = existing.get(document.uri);
        return (
          !current ||
          current.model !== model ||
          current.textSha256 !== agentContinuityEmbeddingTextSha256(document.text)
        );
      });
      if (pending.length === 0) return 0;

      const result = await client.embed({ input: pending.map((document) => document.text) });
      const rows: AgentContinuityObservationEmbedding[] = [];
      pending.forEach((document, index) => {
        const vector = result.vectors[index];
        if (!vector || vector.length === 0) return;
        rows.push({
          observationUri: document.uri,
          model,
          textSha256: agentContinuityEmbeddingTextSha256(document.text),
          vector,
        });
      });
      const written = this.options.store.upsertObservationEmbeddings(
        rows,
        (this.options.now?.() ?? new Date()).toISOString(),
      );
      this.writeFailureReported = false;
      return written;
    } catch (error) {
      if (!this.writeFailureReported) {
        this.writeFailureReported = true;
        this.options.logger?.warn("continuity.semantic.embed_failed", { message: errorMessage(error) });
      }
      return 0;
    }
  }

  /** Persists embeddings for observations; physical and learned sources share the same document contract. */
  async embedObservations(
    observations: readonly { readonly uri: string; readonly summary: string; readonly searchText?: string }[],
  ): Promise<number> {
    return this.embedDocuments(
      observations.flatMap((observation) => {
        const document = projectAgentContinuitySemanticDocument(observation);
        return document ? [document] : [];
      }),
    );
  }

  /** Scores one query against persisted vectors with an explicit channel status. */
  async queryScoresDetailed(
    query: string,
    observations: readonly { readonly uri: string; readonly summary: string; readonly searchText?: string }[],
    input?: { readonly minQueryCharacters?: number; readonly signal?: AbortSignal },
  ): Promise<AgentContinuitySemanticRecallResult> {
    const minQueryCharacters = input?.minQueryCharacters ?? 0;
    if (query.trim().length < minQueryCharacters) {
      return semanticResult(AgentContinuitySemanticRecallStatuses.ShortQuery);
    }
    if (observations.length === 0) {
      return semanticResult(AgentContinuitySemanticRecallStatuses.NoObservations);
    }

    const client = this.options.client;
    if (!client) {
      return semanticResult(AgentContinuitySemanticRecallStatuses.NoClient);
    }

    const model = this.options.model();
    const embeddings = this.options.store.listObservationEmbeddings(observations.map((observation) => observation.uri));
    const documents = observations.flatMap((observation) => {
      const document = projectAgentContinuitySemanticDocument(observation);
      return document ? [document] : [];
    });
    const currentModelEmbeddings = documents.flatMap((document) => {
      const embedding = embeddings.get(document.uri);
      return embedding?.model === model ? [embedding] : [];
    });
    if (currentModelEmbeddings.length === 0) {
      const status =
        embeddings.size === 0
          ? AgentContinuitySemanticRecallStatuses.NoEmbeddings
          : AgentContinuitySemanticRecallStatuses.ModelMismatch;
      return semanticResult(status, embeddings.size);
    }

    let queryVector: number[] | undefined;
    try {
      queryVector = (await client.embed({ input: [query], signal: input?.signal })).vectors[0];
    } catch (error) {
      this.reportReadFailure(error);
      return semanticResult(AgentContinuitySemanticRecallStatuses.RequestFailed, currentModelEmbeddings.length);
    }
    if (!queryVector || queryVector.length === 0) {
      return semanticResult(AgentContinuitySemanticRecallStatuses.NoVector, currentModelEmbeddings.length);
    }

    const compatibleEmbeddings = currentModelEmbeddings.filter(
      (embedding) => embedding.vector.length === queryVector!.length,
    );
    if (compatibleEmbeddings.length === 0) {
      return semanticResult(AgentContinuitySemanticRecallStatuses.DimensionMismatch, currentModelEmbeddings.length, 0);
    }

    const floor = this.options.scoreFloor();
    const scores = new Map<string, number>();
    for (const embedding of compatibleEmbeddings) {
      const score = cosineSimilarity(queryVector, embedding.vector);
      if (score > floor) scores.set(embedding.observationUri, score);
    }
    this.readFailureReported = false;
    return {
      status: AgentContinuitySemanticRecallStatuses.Completed,
      scores,
      indexedCount: currentModelEmbeddings.length,
      compatibleCount: compatibleEmbeddings.length,
    };
  }

  /** Scores one query against persisted vectors for callers that only need scores. */
  async queryScores(
    query: string,
    observations: readonly { readonly uri: string; readonly summary: string; readonly searchText?: string }[],
    input?: { readonly minQueryCharacters?: number; readonly signal?: AbortSignal },
  ): Promise<ReadonlyMap<string, number>> {
    return (await this.queryScoresDetailed(query, observations, input)).scores;
  }

  private reportReadFailure(error: unknown): void {
    if (!this.readFailureReported) {
      this.readFailureReported = true;
      this.options.logger?.warn("continuity.semantic.query_failed", { message: errorMessage(error) });
    }
  }
}

function semanticResult(
  status: AgentContinuitySemanticRecallStatus,
  indexedCount = 0,
  compatibleCount = 0,
): AgentContinuitySemanticRecallResult {
  return { status, scores: new Map(), indexedCount, compatibleCount };
}
