import MiniSearch from "minisearch";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { cosineSimilarity } from "../Vector/AgentVectorSimilarity.js";
import type {
  AgentEmbeddingRequest,
  AgentEmbeddingResult,
  AgentRerankRequest,
  AgentRerankResult,
} from "../Vector/AgentVectorModelClient.js";
import type { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import { sha256Hex, sha256HexOfCanonicalJson } from "../Core/AgentHash.js";

export const AgentCapabilityKinds = {
  Tool: "tool",
  Skill: "skill",
} as const;

export type AgentCapabilityKind = (typeof AgentCapabilityKinds)[keyof typeof AgentCapabilityKinds];

export interface AgentCapabilitySearchDocument {
  readonly id: string;
  readonly kind: AgentCapabilityKind;
  readonly name: string;
  readonly revision: string;
  readonly title: string;
  readonly owner: string;
  readonly sourceText: string;
  readonly tags: string;
  readonly summary: string;
  readonly useCases: string;
  readonly examples: string;
  readonly capabilityText: string;
  readonly capabilityFacets: string;
  readonly parameters: string;
  readonly semanticText: string;
}

export interface AgentCapabilityLexicalMatch {
  readonly name: string;
  readonly score: number;
  readonly queryTerms: readonly string[];
  readonly matchedFields: Readonly<Record<string, readonly string[]>>;
}

export interface AgentCapabilitySemanticMatch {
  readonly name: string;
  readonly score: number;
}

export interface AgentCapabilityRerankMatch extends AgentCapabilitySemanticMatch {
  readonly rank: number;
  readonly normalizedRankScore: number;
}

export interface AgentCapabilityEmbeddingClient {
  embed(request: AgentEmbeddingRequest): Promise<AgentEmbeddingResult>;
}

export interface AgentCapabilityRerankClient {
  rerank(request: AgentRerankRequest): Promise<AgentRerankResult>;
}

export interface AgentCapabilitySearchIndexOptions {
  readonly tokenizer: AgentToolSearchTokenizer;
  readonly embeddingCache?: Map<string, readonly number[]>;
  readonly embedding?: {
    readonly client: AgentCapabilityEmbeddingClient;
    readonly model: string;
    readonly scoreThreshold: number;
  };
  readonly rerank?: {
    readonly client: AgentCapabilityRerankClient;
  };
  readonly onEmbeddingError?: (error: unknown) => void;
  readonly onRerankError?: (error: unknown) => void;
}

const SearchFields = [
  "name",
  "title",
  "owner",
  "sourceText",
  "tags",
  "summary",
  "useCases",
  "examples",
  "capabilityText",
  "capabilityFacets",
  "parameters",
] satisfies Array<keyof AgentCapabilitySearchDocument>;

export class AgentCapabilitySearchIndex {
  private readonly documentsByKind: ReadonlyMap<
    AgentCapabilityKind,
    ReadonlyMap<string, AgentCapabilitySearchDocument>
  >;
  private readonly lexicalIndex: MiniSearch<AgentCapabilitySearchDocument>;
  private readonly embeddingCache: Map<string, readonly number[]>;
  private embeddingPreparation: Promise<void> | undefined;
  private embeddingFailure: unknown;
  private embeddingUnavailable = false;
  private embeddingFailureReported = false;

  constructor(
    private readonly documents: readonly AgentCapabilitySearchDocument[],
    private readonly options: AgentCapabilitySearchIndexOptions,
  ) {
    this.embeddingCache = options.embeddingCache ?? new Map();
    this.documentsByKind = new Map(
      Object.values(AgentCapabilityKinds).map((kind) => [
        kind,
        new Map(documents.filter((document) => document.kind === kind).map((document) => [document.name, document])),
      ]),
    );
    this.lexicalIndex = new MiniSearch<AgentCapabilitySearchDocument>({
      idField: "id",
      fields: [...SearchFields],
      storeFields: ["id", "kind", "name"],
      tokenize: (text) => options.tokenizer.tokenize(text),
      processTerm: (term) => term,
    });
    this.lexicalIndex.addAll(documents);
  }

  lexical(query: string, kind: AgentCapabilityKind, allowedNames?: ReadonlySet<string>): AgentCapabilityLexicalMatch[] {
    return this.lexicalIndex
      .search(query, {
        filter: (result) => result.kind === kind && (!allowedNames || allowedNames.has(String(result.name))),
      })
      .map((result) => ({
        name: String(result.name),
        score: result.score,
        queryTerms: [...result.queryTerms],
        matchedFields: Object.fromEntries(
          Object.entries(result.match).map(([term, fields]) => [term, [...new Set(fields)]]),
        ),
      }));
  }

  async semantic(
    query: string,
    kind: AgentCapabilityKind,
    allowedNames?: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<AgentCapabilitySemanticMatch[]> {
    throwIfAborted(signal);
    const embedding = this.options.embedding;
    if (!embedding || query.trim().length === 0) return [];

    try {
      await this.ensureDocumentEmbeddings(signal);
      throwIfAborted(signal);
      const queryVector = (await embedding.client.embed({ input: [query], signal })).vectors[0];
      throwIfAborted(signal);
      if (!queryVector) return [];

      return this.documents
        .filter((document) => document.kind === kind && (!allowedNames || allowedNames.has(document.name)))
        .flatMap((document) => {
          const vector = this.embeddingCache.get(createAgentCapabilityEmbeddingIdentity(embedding.model, document));
          if (!vector || vector.length !== queryVector.length) return [];
          const score = cosineSimilarity(queryVector, vector);
          return score >= embedding.scoreThreshold ? [{ name: document.name, score }] : [];
        })
        .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
    } catch (error) {
      throwIfAborted(signal);
      if (!this.embeddingFailureReported) {
        this.embeddingFailureReported = true;
        this.options.onEmbeddingError?.(error);
      }
      return [];
    }
  }

  async rerank(
    query: string,
    kind: AgentCapabilityKind,
    names: readonly string[],
    signal?: AbortSignal,
  ): Promise<AgentCapabilityRerankMatch[]> {
    throwIfAborted(signal);
    const rerank = this.options.rerank;
    if (!rerank || names.length === 0 || query.trim().length === 0) return [];

    const documents = names.flatMap((name) => {
      const document = this.document(kind, name);
      return document ? [{ id: name, text: document.semanticText }] : [];
    });
    if (documents.length === 0) return [];

    try {
      const result = await rerank.client.rerank({ query, documents, signal });
      throwIfAborted(signal);
      return result.results.map((entry, index) => ({
        name: entry.id,
        score: entry.score,
        rank: index + 1,
        normalizedRankScore: 1 / (index + 1),
      }));
    } catch (error) {
      throwIfAborted(signal);
      this.options.onRerankError?.(error);
      return [];
    }
  }

  document(kind: AgentCapabilityKind, name: string): AgentCapabilitySearchDocument | undefined {
    return this.documentsByKind.get(kind)?.get(name);
  }

  private ensureDocumentEmbeddings(signal?: AbortSignal): Promise<void> {
    if (this.embeddingUnavailable) return Promise.reject(this.embeddingFailure);
    const current = this.embeddingPreparation;
    if (current) return current;

    const missing = this.documents.filter(
      (document) =>
        !this.embeddingCache.has(
          createAgentCapabilityEmbeddingIdentity(this.options.embedding?.model ?? "disabled", document),
        ),
    );
    if (missing.length === 0) return Promise.resolve();

    const preparation = this.embedDocuments(missing, signal)
      .catch((error) => {
        throwIfAborted(signal);
        this.embeddingFailure = error;
        this.embeddingUnavailable = true;
        throw error;
      })
      .finally(() => {
        if (this.embeddingPreparation === preparation) this.embeddingPreparation = undefined;
      });
    this.embeddingPreparation = preparation;
    return preparation;
  }

  private async embedDocuments(
    documents: readonly AgentCapabilitySearchDocument[],
    signal?: AbortSignal,
  ): Promise<void> {
    const embedding = this.options.embedding;
    if (!embedding) return;
    const result = await embedding.client.embed({
      input: documents.map((document) => document.semanticText),
      signal,
    });
    documents.forEach((document, index) => {
      const vector = result.vectors[index];
      if (vector) {
        this.embeddingCache.set(createAgentCapabilityEmbeddingIdentity(embedding.model, document), vector);
      }
    });
  }
}

export function createAgentCapabilityEmbeddingIdentity(
  model: string,
  document: Pick<AgentCapabilitySearchDocument, "id" | "semanticText">,
): string {
  return sha256HexOfCanonicalJson([model, document.id, sha256Hex(document.semanticText)]);
}
