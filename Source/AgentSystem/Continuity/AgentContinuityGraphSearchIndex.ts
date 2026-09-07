import MiniSearch from "minisearch";
import type { AgentContinuityConceptRecord } from "./AgentContinuityConceptCatalog.js";
import type { AgentContinuityGraphEntity, AgentContinuityGraphSnapshot } from "./AgentContinuityGraphTypes.js";
import { AgentContinuityRecallRankingDefaults } from "./AgentContinuityRecallDefaults.js";
import {
  buildAgentContinuityRecallVocabulary,
  type AgentContinuityRecallVocabulary,
} from "./AgentContinuityRecallVocabulary.js";
import { agentContinuityScopeKey } from "./AgentContinuityScopes.js";
import type { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";

type AgentContinuityGraphSearchSource = "concept" | "entity";

interface AgentContinuityGraphSearchDocument {
  readonly id: string;
  readonly uri: string;
  readonly source: AgentContinuityGraphSearchSource;
  readonly label: string;
  readonly aliases: string;
}

interface AgentContinuityGraphSearchSnapshot {
  readonly fingerprint: string;
  readonly builtAtMs: number;
  readonly index: MiniSearch<AgentContinuityGraphSearchDocument>;
  readonly documents: ReadonlyMap<string, AgentContinuityGraphSearchDocument>;
  readonly vocabulary: AgentContinuityRecallVocabulary;
}

export interface AgentContinuityGraphSearchSelection {
  readonly concepts: readonly AgentContinuityConceptRecord[];
  readonly entities: readonly AgentContinuityGraphEntity[];
  readonly vocabulary: AgentContinuityRecallVocabulary;
}

export interface AgentContinuityGraphSearchIndexInput {
  readonly query: string;
  readonly concepts: readonly AgentContinuityConceptRecord[];
  readonly graph: AgentContinuityGraphSnapshot;
  readonly nowMs: number;
  readonly cacheTtlMs: number;
  readonly maxConcepts: number;
  readonly maxEntities: number;
}

/**
 * Caches the searchable entity surface independently of fact ranking. It
 * keeps MiniSearch as the broad phase and leaves Jieba/fuzzysort scoring to
 * the query planner's bounded candidate set.
 */
export class AgentContinuityGraphSearchIndex {
  private readonly snapshots = new Map<string, AgentContinuityGraphSearchSnapshot>();

  constructor(
    private readonly similarity: Pick<AgentContinuityTextSimilarity, "contentTerms" | "searchTerms">,
    private readonly lexical: ResolvedAgentContinuityRecallRankingConfig["Lexical"] = AgentContinuityRecallRankingDefaults.Lexical,
  ) {}

  warm(input: Omit<AgentContinuityGraphSearchIndexInput, "query" | "maxConcepts" | "maxEntities">): void {
    this.prepare(input);
  }

  select(input: AgentContinuityGraphSearchIndexInput): AgentContinuityGraphSearchSelection {
    validateInput(input);
    const snapshot = this.prepare(input);
    const query = input.query.trim();
    if (!query) return { concepts: [], entities: [], vocabulary: snapshot.vocabulary };

    const conceptsByUri = new Map(input.concepts.map((concept) => [concept.uri, concept] as const));
    const entitiesByUri = new Map(input.graph.entities.map((entity) => [entity.uri, entity] as const));
    const conceptUris: string[] = [];
    const entityUris: string[] = [];
    const seenConceptUris = new Set<string>();
    const seenEntityUris = new Set<string>();
    for (const result of snapshot.index.search(query)) {
      const document = snapshot.documents.get(String(result.id));
      if (!document) throw new Error(`Continuity graph search result lacks its document: ${String(result.id)}`);
      if (document.source === "concept") {
        if (conceptUris.length >= input.maxConcepts || seenConceptUris.has(document.uri)) continue;
        if (conceptsByUri.has(document.uri)) {
          conceptUris.push(document.uri);
          seenConceptUris.add(document.uri);
        }
        continue;
      }
      if (entityUris.length >= input.maxEntities || seenEntityUris.has(document.uri)) continue;
      if (entitiesByUri.has(document.uri)) {
        entityUris.push(document.uri);
        seenEntityUris.add(document.uri);
      }
    }
    return {
      concepts: conceptUris.flatMap((uri) => {
        const concept = conceptsByUri.get(uri);
        return concept ? [concept] : [];
      }),
      entities: entityUris.flatMap((uri) => {
        const entity = entitiesByUri.get(uri);
        return entity ? [entity] : [];
      }),
      vocabulary: snapshot.vocabulary,
    };
  }

  clear(scopeKey?: string): void {
    if (scopeKey === undefined) {
      this.snapshots.clear();
      return;
    }
    this.snapshots.delete(scopeKey);
  }

  private prepare(
    input: Omit<AgentContinuityGraphSearchIndexInput, "query" | "maxConcepts" | "maxEntities">,
  ): AgentContinuityGraphSearchSnapshot {
    const scopeKey = agentContinuityScopeKey(input.graph.scope);
    const documents = buildDocuments(input.concepts, input.graph.entities);
    const fingerprint = documents.map(documentFingerprint).join("\u0001");
    this.removeExpired(input.nowMs, input.cacheTtlMs);
    const cached = this.snapshots.get(scopeKey);
    if (
      input.cacheTtlMs > 0 &&
      cached &&
      cached.fingerprint === fingerprint &&
      input.nowMs - cached.builtAtMs <= input.cacheTtlMs
    ) {
      return cached;
    }

    const index = new MiniSearch<AgentContinuityGraphSearchDocument>({
      idField: "id",
      fields: ["label", "aliases"],
      tokenize: (text) => this.similarity.searchTerms(text),
      processTerm: (term) => term,
      searchOptions: {
        prefix: this.lexical.Prefix,
        fuzzy: this.lexical.Fuzzy,
        combineWith: this.lexical.CombineWith,
      },
    });
    index.addAll(documents);
    const snapshot: AgentContinuityGraphSearchSnapshot = {
      fingerprint,
      builtAtMs: input.nowMs,
      index,
      documents: new Map(documents.map((document) => [document.id, document] as const)),
      vocabulary: buildVocabulary(documents, this.similarity),
    };
    if (input.cacheTtlMs > 0) this.snapshots.set(scopeKey, snapshot);
    return snapshot;
  }

  private removeExpired(nowMs: number, cacheTtlMs: number): void {
    // A non-caching request builds an ephemeral snapshot and must not evict a
    // separately warmed snapshot owned by a positive-TTL request.
    if (cacheTtlMs <= 0 || cacheTtlMs === Number.POSITIVE_INFINITY) return;
    for (const [key, snapshot] of this.snapshots) {
      if (nowMs - snapshot.builtAtMs > cacheTtlMs) this.snapshots.delete(key);
    }
  }
}

function buildDocuments(
  concepts: readonly AgentContinuityConceptRecord[],
  entities: readonly AgentContinuityGraphEntity[],
): AgentContinuityGraphSearchDocument[] {
  return [
    ...concepts.map((concept) => toDocument("concept", concept.uri, concept.label, concept.aliases)),
    ...entities
      .filter((entity) => entity.status === "active")
      .map((entity) => toDocument("entity", entity.uri, entity.label, entity.aliases)),
  ].sort((left, right) => left.id.localeCompare(right.id));
}

function toDocument(
  source: AgentContinuityGraphSearchSource,
  uri: string,
  label: string,
  aliases: readonly string[],
): AgentContinuityGraphSearchDocument {
  return {
    id: `${source}:${uri}`,
    uri,
    source,
    label,
    aliases: aliases.join("\n"),
  };
}

function buildVocabulary(
  documents: readonly AgentContinuityGraphSearchDocument[],
  similarity: Pick<AgentContinuityTextSimilarity, "contentTerms" | "searchTerms">,
): AgentContinuityRecallVocabulary {
  return buildAgentContinuityRecallVocabulary(
    documents.map((document) =>
      [document.label, document.aliases].flatMap((value) => similarity.searchTerms(value)).map(normalize),
    ),
  );
}

function documentFingerprint(document: AgentContinuityGraphSearchDocument): string {
  return [document.id, document.label, document.aliases].join("\u0000");
}

function validateInput(input: AgentContinuityGraphSearchIndexInput): void {
  if (!Number.isFinite(input.nowMs)) throw new Error("Continuity graph search requires a valid current time.");
  if (!Number.isFinite(input.cacheTtlMs) || input.cacheTtlMs < 0) {
    throw new Error("Continuity graph search cache TTL must be non-negative.");
  }
  for (const [name, value] of [
    ["maxConcepts", input.maxConcepts],
    ["maxEntities", input.maxEntities],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Continuity graph search ${name} must be non-negative.`);
    }
  }
}

function normalize(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}
