import MiniSearch from "minisearch";
import fuzzysort, { type Prepared as FuzzyPrepared } from "fuzzysort";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { cosineSimilarity } from "../Vector/AgentVectorSimilarity.js";
import {
  AgentEmbeddingPriorities,
  type AgentEmbeddingClient,
  type AgentEmbeddingPriority,
  resolveAgentEmbeddingBatchSize,
} from "../Vector/AgentEmbeddingContract.js";
import type { AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import { sha256Hex, sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentCapabilityEmbeddingCacheStore } from "./AgentCapabilityEmbeddingCache.js";
import { partitionAgentToolSearchScoreCurve } from "./AgentToolSearchConfidence.js";

export const AgentCapabilityKinds = {
  Tool: "tool",
  Skill: "skill",
  Service: "service",
} as const;

export type AgentCapabilityKind = (typeof AgentCapabilityKinds)[keyof typeof AgentCapabilityKinds];

export interface AgentCapabilitySemanticInput {
  /** Stable structural key, independent of the language used by the text. */
  readonly id: string;
  readonly text: string;
}

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
  /** Short, explicitly declared identifiers and aliases only. Never long-form prose. */
  readonly fuzzyText: string;
  /**
   * Separate semantic views derived from the actual capability fields. The
   * index can choose the strongest view for a query without guessing its
   * language or maintaining a language-specific branch.
   */
  readonly semanticInputs: readonly AgentCapabilitySemanticInput[];
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
  readonly inputId?: string;
}

export type AgentCapabilityFuzzyMatch = AgentCapabilitySemanticMatch;

export type AgentCapabilityEmbeddingClient = AgentEmbeddingClient;

export interface AgentCapabilitySearchIndexOptions {
  readonly tokenizer: AgentToolSearchTokenizer;
  readonly embeddingCache?: Map<string, readonly number[]>;
  readonly embeddingCacheStore?: AgentCapabilityEmbeddingCacheStore;
  readonly embedding?: {
    readonly client: AgentCapabilityEmbeddingClient;
    readonly model: string;
  };
  readonly onEmbeddingError?: (error: unknown) => void;
  readonly onEmbeddingCacheError?: (error: unknown) => void;
}

interface AgentEmbeddingPreparationRequest {
  readonly priority: AgentEmbeddingPriority;
  readonly signal?: AbortSignal;
  readonly inputSelector?: AgentCapabilitySemanticInputSelector;
  readonly kind?: AgentCapabilityKind;
  readonly allowedNames?: ReadonlySet<string>;
}

type AgentCapabilitySemanticInputSelector = (
  document: AgentCapabilitySearchDocument,
  input: AgentCapabilitySemanticInput,
) => boolean;

interface AgentCapabilityEmbeddingInput {
  readonly document: AgentCapabilitySearchDocument;
  readonly input: AgentCapabilitySemanticInput;
}

interface AgentEmbeddingPreparation {
  readonly priority: AgentEmbeddingPriority;
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

/** A foreground search may interrupt derived catalog warmup, but never a
 * foreground embedding request. This is a scheduling transition rather than
 * a retrieval failure. */
class AgentEmbeddingPreparationPreemptedError extends Error {
  constructor() {
    super("Capability embedding warmup was preempted by a foreground search.");
    this.name = "AgentEmbeddingPreparationPreemptedError";
  }
}

const SearchFields = [
  "name",
  "title",
  "tags",
  "summary",
  "useCases",
  "capabilityText",
  "capabilityFacets",
] satisfies Array<keyof AgentCapabilitySearchDocument>;

const LexicalFieldBoosts = {
  name: 4,
  title: 3,
  tags: 2,
  summary: 2,
  useCases: 2,
  capabilityText: 1.5,
  capabilityFacets: 1.5,
} as const;

export class AgentCapabilitySearchIndex {
  private readonly documentsByKind: ReadonlyMap<
    AgentCapabilityKind,
    ReadonlyMap<string, AgentCapabilitySearchDocument>
  >;
  private readonly lexicalIndex: MiniSearch<AgentCapabilitySearchDocument>;
  private readonly fuzzyTermsByDocument = new Map<string, readonly FuzzyPrepared[]>();
  private readonly embeddingCache: Map<string, readonly number[]>;
  private embeddingPreparation: AgentEmbeddingPreparation | undefined;
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
    documents.forEach((document) => {
      const terms = document.fuzzyText
        .split("\n")
        .map((term) => term.trim())
        .filter(Boolean)
        .map((term) => fuzzysort.prepare(term));
      this.fuzzyTermsByDocument.set(document.id, terms);
    });
    this.hydrateEmbeddingCache();
  }

  lexical(query: string, kind: AgentCapabilityKind, allowedNames?: ReadonlySet<string>): AgentCapabilityLexicalMatch[] {
    return this.lexicalIndex
      .search(query, {
        filter: (result) => result.kind === kind && (!allowedNames || allowedNames.has(String(result.name))),
        boost: LexicalFieldBoosts,
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

  fuzzy(
    query: string,
    kind: AgentCapabilityKind,
    options: { minScore: number; allowedNames?: ReadonlySet<string> },
  ): AgentCapabilityFuzzyMatch[] {
    const queryTerms = this.options.tokenizer.tokenize(query).filter((term) => term.length >= 2);
    if (queryTerms.length === 0) return [];

    return this.documents
      .filter(
        (document) => document.kind === kind && (!options.allowedNames || options.allowedNames.has(document.name)),
      )
      .flatMap((document) => {
        const terms = this.fuzzyTermsByDocument.get(document.id) ?? [];
        const matched = queryTerms.flatMap((queryTerm) => {
          const score = bestFuzzyScore(queryTerm, terms);
          return score >= options.minScore ? [score] : [];
        });
        if (matched.length === 0) return [];
        return [
          {
            name: document.name,
            // Prefer candidates that match more explicit intent terms; average score breaks ties.
            score: matched.length + matched.reduce((total, score) => total + score, 0) / matched.length,
          },
        ];
      })
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  }

  async semantic(
    query: string,
    kind: AgentCapabilityKind,
    allowedNames?: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<AgentCapabilitySemanticMatch[]> {
    throwIfAborted(signal);
    const embedding = this.options.embedding;
    if (!embedding || query.trim().length === 0 || allowedNames?.size === 0) return [];

    try {
      await embedding.client.prewarm?.(signal, AgentEmbeddingPriorities.Foreground);
      throwIfAborted(signal);
      const primaryInputSelector = this.primarySemanticInputSelector();
      await this.ensureDocumentEmbeddings({
        priority: AgentEmbeddingPriorities.Foreground,
        signal,
        inputSelector: primaryInputSelector,
        kind,
        allowedNames,
      });
      this.embeddingFailureReported = false;
      throwIfAborted(signal);
      const queryVector = (
        await embedding.client.embed({
          input: [query],
          role: "query",
          priority: AgentEmbeddingPriorities.Foreground,
          signal,
        })
      ).vectors[0];
      throwIfAborted(signal);
      if (!queryVector || queryVector.length === 0) {
        throw new Error("Capability embedding response did not contain a query vector.");
      }

      const primaryMatches = this.semanticScores(queryVector, kind, allowedNames, primaryInputSelector);
      const auxiliaryCandidateNames = this.auxiliarySemanticCandidateNames(primaryMatches);
      if (auxiliaryCandidateNames.size === 0) return primaryMatches;

      await this.ensureDocumentEmbeddings({
        priority: AgentEmbeddingPriorities.Foreground,
        signal,
        kind,
        allowedNames: auxiliaryCandidateNames,
        inputSelector: (document, input) =>
          auxiliaryCandidateNames.has(document.name) && !primaryInputSelector(document, input),
      });
      return this.semanticScores(
        queryVector,
        kind,
        allowedNames,
        (document, input) => primaryInputSelector(document, input) || auxiliaryCandidateNames.has(document.name),
      );
    } catch (error) {
      throwIfAborted(signal);
      if (!this.embeddingFailureReported) {
        this.embeddingFailureReported = true;
        this.options.onEmbeddingError?.(error);
      }
      // Semantic retrieval is one component of the single discovery
      // algorithm. The caller may continue with deterministic evidence, but
      // only after it receives an explicit diagnostic for this degradation.
      throw error;
    }
  }

  /**
   * Prepares the primary semantic view for every current capability through
   * the same in-flight promise used by foreground searches. Auxiliary views
   * are demand-driven: a foreground query expands them only when primary
   * retrieval is ambiguous.
   */
  async prewarm(signal?: AbortSignal): Promise<void> {
    const embedding = this.options.embedding;
    if (!embedding) return;
    await embedding.client.prewarm?.(signal, AgentEmbeddingPriorities.Background);
    throwIfAborted(signal);
    const primaryInputSelector = this.primarySemanticInputSelector();
    while (true) {
      throwIfAborted(signal);
      try {
        await this.ensureDocumentEmbeddings({
          priority: AgentEmbeddingPriorities.Background,
          signal,
          inputSelector: primaryInputSelector,
        });
        return;
      } catch (error) {
        if (!(error instanceof AgentEmbeddingPreparationPreemptedError)) throw error;
        // Yield before resuming the derived work so the request which
        // preempted this warmup can claim the embedding lane first.
        await yieldAgentEmbeddingPreparation(signal);
      }
    }
  }

  private semanticScores(
    queryVector: readonly number[],
    kind: AgentCapabilityKind,
    allowedNames: ReadonlySet<string> | undefined,
    inputSelector: AgentCapabilitySemanticInputSelector,
  ): AgentCapabilitySemanticMatch[] {
    const model = this.options.embedding?.model ?? "disabled";
    return this.documents
      .filter((document) => document.kind === kind && (!allowedNames || allowedNames.has(document.name)))
      .flatMap((document) => {
        const best = this.semanticInputs(document)
          .filter((input) => inputSelector(document, input))
          .flatMap((input) => {
            const vector = this.embeddingCache.get(createAgentCapabilityEmbeddingIdentity(model, document, input.id));
            if (!vector) return [];
            if (vector.length !== queryVector.length) {
              throw new Error(
                `Capability embedding dimension mismatch for ${document.name}/${input.id}: ${vector.length} != ${queryVector.length}.`,
              );
            }
            return [{ inputId: input.id, score: cosineSimilarity(queryVector, vector) }];
          })
          .sort((left, right) => right.score - left.score || left.inputId.localeCompare(right.inputId))[0];
        return best ? [{ name: document.name, score: best.score, inputId: best.inputId }] : [];
      })
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  }

  document(kind: AgentCapabilityKind, name: string): AgentCapabilitySearchDocument | undefined {
    return this.documentsByKind.get(kind)?.get(name);
  }

  private async ensureDocumentEmbeddings(request: AgentEmbeddingPreparationRequest): Promise<void> {
    const model = this.options.embedding?.model ?? "disabled";
    const missing = this.missingEmbeddingInputs(model, request.inputSelector, request.kind, request.allowedNames);
    if (missing.length === 0) return;

    const current = this.embeddingPreparation;
    if (current) {
      if (
        request.priority === AgentEmbeddingPriorities.Foreground &&
        current.priority === AgentEmbeddingPriorities.Background
      ) {
        current.controller.abort(new AgentEmbeddingPreparationPreemptedError());
      }
      try {
        await waitForAgentEmbeddingPreparation(current.promise, request.signal);
      } catch (error) {
        const backgroundPreparationStopped =
          current.priority === AgentEmbeddingPriorities.Background && current.controller.signal.aborted;
        if (
          request.signal?.aborted ||
          (!(error instanceof AgentEmbeddingPreparationPreemptedError) && !backgroundPreparationStopped)
        ) {
          throw error;
        }
      }
      const remaining = this.missingEmbeddingInputs(model, request.inputSelector, request.kind, request.allowedNames);
      if (remaining.length === 0) return;
      return this.ensureDocumentEmbeddings(request);
    }

    const controller = new AbortController();
    const promise = this.embedDocuments(missing, controller.signal, request.priority);
    const preparation: AgentEmbeddingPreparation = {
      priority: request.priority,
      controller,
      promise,
    };
    this.embeddingPreparation = preparation;
    void promise.then(
      () => {
        if (this.embeddingPreparation === preparation) this.embeddingPreparation = undefined;
      },
      () => {
        if (this.embeddingPreparation === preparation) this.embeddingPreparation = undefined;
      },
    );
    const unbindCancellation =
      request.priority === AgentEmbeddingPriorities.Background
        ? bindAgentEmbeddingPreparationCancellation(request.signal, controller)
        : undefined;
    try {
      await waitForAgentEmbeddingPreparation(preparation.promise, request.signal);
    } finally {
      unbindCancellation?.();
    }
  }

  private missingEmbeddingInputs(
    model: string,
    inputSelector?: AgentCapabilitySemanticInputSelector,
    kind?: AgentCapabilityKind,
    allowedNames?: ReadonlySet<string>,
  ): AgentCapabilityEmbeddingInput[] {
    return this.documents.flatMap((document) =>
      (kind !== undefined && document.kind !== kind) || (allowedNames && !allowedNames.has(document.name))
        ? []
        : this.semanticInputs(document).flatMap((input) =>
            (!inputSelector || inputSelector(document, input)) &&
            !this.embeddingCache.has(createAgentCapabilityEmbeddingIdentity(model, document, input.id))
              ? [{ document, input }]
              : [],
          ),
    );
  }

  private primarySemanticInputSelector(): AgentCapabilitySemanticInputSelector {
    const primaryInputIds = new Map(
      this.documents.flatMap((document) => {
        const first = this.semanticInputs(document)[0];
        return first ? [[document.id, first.id] as const] : [];
      }),
    );
    return (document, input) => primaryInputIds.get(document.id) === input.id;
  }

  private auxiliarySemanticCandidateNames(matches: readonly AgentCapabilitySemanticMatch[]): ReadonlySet<string> {
    const embedding = this.options.embedding;
    if (!embedding || !this.hasAuxiliarySemanticViews()) return new Set();
    // A second view can only affect a comparison. With one candidate there is
    // no ranking decision to change, so deriving its long-form views burns
    // foreground time without improving discovery or disclosure.
    if (matches.length < 2) return new Set();
    const curve = partitionAgentToolSearchScoreCurve(matches);
    // The primary view already covers the full catalog. Expand long-form
    // views only for a statistically separated leading band; a flat curve
    // lacks evidence that derived vectors can improve a decision, so it does
    // not silently become a full-catalog foreground expansion.
    return new Set((curve.bands.length > 1 ? curve.bands[0] : []).map((entry) => entry.name));
  }

  private hasAuxiliarySemanticViews(): boolean {
    return this.documents.some((document) => this.semanticInputs(document).length > 1);
  }

  private async embedDocuments(
    inputs: readonly AgentCapabilityEmbeddingInput[],
    signal?: AbortSignal,
    priority: AgentEmbeddingPriority = AgentEmbeddingPriorities.Foreground,
  ): Promise<void> {
    await this.embedDocumentsCooperatively(inputs, signal, priority);
  }

  private async embedDocumentsCooperatively(
    inputs: readonly AgentCapabilityEmbeddingInput[],
    signal?: AbortSignal,
    priority: AgentEmbeddingPriority = AgentEmbeddingPriorities.Foreground,
  ): Promise<void> {
    const embedding = this.options.embedding;
    if (!embedding) return;

    let cacheChanged = false;
    try {
      const batchSize = resolveAgentEmbeddingBatchSize(embedding.client.maxBatchSize, inputs.length);
      for (let offset = 0; offset < inputs.length; offset += batchSize) {
        const batch = inputs.slice(offset, offset + batchSize);
        throwIfAgentEmbeddingPreparationAborted(signal);
        const result = await embedding.client.embed({
          input: batch.map((item) => item.input.text),
          role: "document",
          priority,
          signal,
        });
        throwIfAgentEmbeddingPreparationAborted(signal);
        this.cacheEmbeddingVectors(batch, result.vectors);
        cacheChanged = true;
        if (offset + batch.length < inputs.length) await yieldAgentEmbeddingPreparation(signal);
      }
    } finally {
      // Persist completed units even when foreground work preempts the rest
      // of warmup. The cache is content-addressed, so this never changes the
      // authoritative catalog and avoids recomputing already-derived vectors.
      if (cacheChanged) this.persistEmbeddingCache();
    }
  }

  private cacheEmbeddingVectors(
    inputs: readonly AgentCapabilityEmbeddingInput[],
    vectors: readonly (readonly number[])[],
  ): void {
    const embedding = this.options.embedding;
    if (!embedding) return;
    if (vectors.length !== inputs.length) {
      throw new Error(`Capability embedding response count mismatch: ${vectors.length} != ${inputs.length}.`);
    }
    inputs.forEach(({ document, input }, index) => {
      const vector = vectors[index];
      if (!vector || vector.length === 0) {
        throw new Error(`Capability embedding response did not contain a vector for ${document.name}/${input.id}.`);
      }
      this.embeddingCache.set(createAgentCapabilityEmbeddingIdentity(embedding.model, document, input.id), vector);
    });
  }

  private persistEmbeddingCache(): void {
    try {
      this.options.embeddingCacheStore?.replace(this.embeddingCache);
    } catch (error) {
      // The vector file is derived state. A write failure must not turn a
      // successful foreground retrieval into a false negative.
      this.options.onEmbeddingCacheError?.(error);
    }
  }

  private hydrateEmbeddingCache(): void {
    const embedding = this.options.embedding;
    const store = this.options.embeddingCacheStore;
    if (!embedding || !store) return;

    const keys = new Set(
      this.documents.flatMap((document) =>
        this.semanticInputs(document).map((input) =>
          createAgentCapabilityEmbeddingIdentity(embedding.model, document, input.id),
        ),
      ),
    );
    for (const [key, vector] of store.load(keys)) this.embeddingCache.set(key, vector);
  }

  private semanticInputs(document: AgentCapabilitySearchDocument): readonly AgentCapabilitySemanticInput[] {
    return document.semanticInputs.length > 0 ? document.semanticInputs : [{ id: "full", text: document.semanticText }];
  }

  async close(): Promise<void> {
    const preparation = this.embeddingPreparation;
    if (!preparation) return;
    preparation.controller.abort("Capability search index is closing.");
    await preparation.promise.catch(() => undefined);
  }
}

function bestFuzzyScore(query: string, targets: readonly FuzzyPrepared[]): number {
  return targets.reduce((best, target) => Math.max(best, fuzzysort.single(query, target)?.score ?? 0), 0);
}

function throwIfAgentEmbeddingPreparationAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throwIfAborted(signal);
}

function waitForAgentEmbeddingPreparation<T>(preparation: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return preparation;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () =>
      settle(() => {
        try {
          throwIfAborted(signal);
        } catch (error) {
          reject(error);
        }
      });
    signal.addEventListener("abort", onAbort, { once: true });
    preparation.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}

function bindAgentEmbeddingPreparationCancellation(
  signal: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  if (!signal) return () => undefined;
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

function yieldAgentEmbeddingPreparation(signal?: AbortSignal): Promise<void> {
  throwIfAgentEmbeddingPreparationAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const immediate = setImmediate(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    });
    const onAbort = () => {
      clearImmediate(immediate);
      signal?.removeEventListener("abort", onAbort);
      try {
        throwIfAgentEmbeddingPreparationAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createAgentCapabilityEmbeddingIdentity(
  model: string,
  document: Pick<AgentCapabilitySearchDocument, "id" | "semanticText" | "semanticInputs">,
  inputId = "full",
): string {
  const input = document.semanticInputs.find((candidate) => candidate.id === inputId) ?? {
    id: "full",
    text: document.semanticText,
  };
  return sha256HexOfCanonicalJson([model, document.id, input.id, sha256Hex(input.text)]);
}
