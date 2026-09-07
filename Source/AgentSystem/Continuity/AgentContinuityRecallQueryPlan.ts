import type { AgentContinuityConceptRecord } from "./AgentContinuityConceptCatalog.js";
import type { AgentContinuityGraphEntity, AgentContinuityGraphSnapshot } from "./AgentContinuityGraphTypes.js";
import {
  AgentContinuityRelationCatalog,
  DefaultAgentContinuityGraphTraversal,
} from "./AgentContinuityRelationCatalog.js";
import {
  traverseAgentContinuityGraph,
  type AgentContinuityGraphTraversalPath,
} from "./AgentContinuityGraphTraversal.js";
import type { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import {
  AgentContinuityRecallAnchorDefaults,
  scoreAgentContinuityRecallLabels,
  type AgentContinuityRecallAnchorPolicy,
} from "./AgentContinuityRecallAnchorPolicy.js";
import {
  buildAgentContinuityRecallVocabulary,
  type AgentContinuityRecallVocabulary,
} from "./AgentContinuityRecallVocabulary.js";
import { uniqueStrings } from "./AgentContinuitySqliteUtils.js";

export interface AgentContinuityRecallQueryMatch {
  readonly uri?: string;
  readonly label: string;
  readonly kind?: string;
  readonly score: number;
  readonly direct: boolean;
  readonly matchedBy: readonly ("phrase" | "token" | "fuzzy")[];
  readonly matchedTerms: readonly string[];
  readonly matchedLabel?: string;
  /** Only entity matches can seed graph traversal. */
  readonly anchorEligible: boolean;
}

export interface AgentContinuityRecallRelationMatch {
  readonly relationId: string;
  readonly label: string;
  readonly score: number;
  readonly direct: boolean;
}

export interface AgentContinuityRecallQueryPlan {
  readonly original: string;
  readonly expandedQuery: string;
  readonly terms: readonly string[];
  readonly conceptMatches: readonly AgentContinuityRecallQueryMatch[];
  readonly entityMatches: readonly AgentContinuityRecallQueryMatch[];
  readonly relationMatches: readonly AgentContinuityRecallRelationMatch[];
  readonly anchorUris: readonly string[];
}

/**
 * Serializable, URI-free explanation of a local recall plan. The plan itself
 * retains canonical URIs for graph traversal; events expose only labels so the
 * audit stream cannot become another storage contract.
 */
export interface AgentContinuityRecallQueryPlanAudit {
  readonly terms: readonly string[];
  readonly concepts: readonly AgentContinuityRecallQueryPlanAuditMatch[];
  readonly entities: readonly AgentContinuityRecallQueryPlanAuditMatch[];
  readonly relations: readonly AgentContinuityRecallQueryPlanAuditRelation[];
  readonly anchorLabels: readonly string[];
  readonly expanded: boolean;
}

export interface AgentContinuityRecallQueryPlanAuditMatch {
  readonly label: string;
  readonly kind?: string;
  readonly score: number;
  readonly direct: boolean;
  readonly matchedBy: readonly ("phrase" | "token" | "fuzzy")[];
  readonly matchedTerms?: readonly string[];
  readonly matchedLabel?: string;
  readonly anchorEligible?: boolean;
}

export interface AgentContinuityRecallQueryPlanAuditRelation {
  readonly relationId: string;
  readonly label: string;
  readonly score: number;
  readonly direct: boolean;
}

export interface AgentContinuityRecallQueryPlanOptions {
  readonly query: string;
  readonly concepts: readonly AgentContinuityConceptRecord[];
  readonly graph: AgentContinuityGraphSnapshot;
  readonly similarity: Pick<AgentContinuityTextSimilarity, "compare" | "terms" | "contentTerms">;
  readonly now: Date;
  readonly minimumScore: number;
  readonly directScore: number;
  readonly maxConceptMatches: number;
  readonly maxEntityMatches: number;
  readonly maxRelationMatches: number;
  /** Maximum graph distance used to expand direct entity anchors. */
  readonly maxGraphHops?: number;
  readonly anchorPolicy?: AgentContinuityRecallAnchorPolicy;
  /**
   * Optional indexed candidate set. Omitting it keeps this pure helper useful
   * for small catalogs and tests; the runtime supplies it for bounded scoring.
   */
  readonly candidates?: AgentContinuityRecallQueryPlanCandidates;
}

export interface AgentContinuityRecallQueryPlanCandidates {
  readonly concepts: readonly AgentContinuityConceptRecord[];
  readonly entities: readonly AgentContinuityGraphEntity[];
  readonly vocabulary: AgentContinuityRecallVocabulary;
}

export type { AgentContinuityRecallVocabulary } from "./AgentContinuityRecallVocabulary.js";

/**
 * Builds the local recall query once per turn. The planner is deliberately
 * model-free: storage identities and relation vocabulary remain authoritative,
 * while fuzzy matches only contribute search terms when they have a lexical
 * anchor in the user's message.
 */
export function createAgentContinuityRecallQueryPlan(
  options: AgentContinuityRecallQueryPlanOptions,
): AgentContinuityRecallQueryPlan {
  validateOptions(options);
  const original = options.query.trim();
  const terms = uniqueStrings(options.similarity.terms(original).map(normalize));
  const contentTerms = uniqueStrings(options.similarity.contentTerms(original).map(normalize));
  if (!original) return emptyPlan(original, terms);
  const vocabulary = options.candidates?.vocabulary ?? buildVocabulary(options);
  const anchorPolicy = options.anchorPolicy ?? AgentContinuityRecallAnchorDefaults;

  const conceptMatches = rankConceptMatches(
    options,
    options.candidates?.concepts ?? options.concepts,
    original,
    contentTerms,
    vocabulary,
    anchorPolicy,
  );
  const entityMatches = rankEntityMatches(
    options,
    options.candidates?.entities ?? options.graph.entities,
    original,
    contentTerms,
    vocabulary,
    anchorPolicy,
  );
  const relationMatches = rankRelationMatches(options, original, contentTerms, vocabulary, anchorPolicy);
  // Concepts are fact/profile catalog entries as well as graph identities.
  // Only actual graph entities may open a traversal path; a fact sentence
  // must never become an expansion anchor merely because it shares a token.
  const anchorUris = uniqueStrings(
    entityMatches.flatMap((match) => (match.uri && isDirectAnchor(match, options.directScore) ? [match.uri] : [])),
  );
  const expandedQuery = buildExpandedQuery({
    original,
    concepts: conceptMatches,
    entities: entityMatches,
    relations: relationMatches,
    graph: options.graph,
    anchorUris: new Set(anchorUris),
    now: options.now,
    maxRelationMatches: options.maxRelationMatches,
    directScore: options.directScore,
    maxGraphHops: options.maxGraphHops ?? DefaultAgentContinuityGraphTraversal.maxHops,
  });

  return {
    original,
    expandedQuery,
    terms,
    conceptMatches,
    entityMatches,
    relationMatches,
    anchorUris,
  };
}

/** Projects the local planner without leaking its persistence identities. */
export function projectAgentContinuityRecallQueryPlanAudit(
  plan: AgentContinuityRecallQueryPlan,
): AgentContinuityRecallQueryPlanAudit {
  const matchesByUri = new Map(
    [...plan.conceptMatches, ...plan.entityMatches]
      .filter((match): match is AgentContinuityRecallQueryMatch & { readonly uri: string } => Boolean(match.uri))
      .map((match) => [match.uri, match] as const),
  );
  return {
    terms: [...plan.terms],
    concepts: plan.conceptMatches.map(projectMatch),
    entities: plan.entityMatches.map(projectMatch),
    relations: plan.relationMatches.map((match) => ({
      relationId: match.relationId,
      label: match.label,
      score: match.score,
      direct: match.direct,
    })),
    anchorLabels: uniqueStrings(
      plan.anchorUris.flatMap((uri) => {
        const match = plan.entityMatches.find((entry) => entry.uri === uri) ?? matchesByUri.get(uri);
        const label = match?.matchedLabel ?? match?.label;
        return label ? [label] : [];
      }),
    ),
    expanded: plan.expandedQuery !== plan.original,
  };
}

function projectMatch(match: AgentContinuityRecallQueryMatch): AgentContinuityRecallQueryPlanAuditMatch {
  return {
    label: match.label,
    ...(match.kind ? { kind: match.kind } : {}),
    score: match.score,
    direct: match.direct,
    matchedBy: [...match.matchedBy],
    ...(match.matchedTerms.length > 0 ? { matchedTerms: [...match.matchedTerms] } : {}),
    ...(match.matchedLabel ? { matchedLabel: match.matchedLabel } : {}),
    anchorEligible: match.anchorEligible,
  };
}

function rankConceptMatches(
  options: AgentContinuityRecallQueryPlanOptions,
  concepts: readonly AgentContinuityConceptRecord[],
  query: string,
  terms: readonly string[],
  vocabulary: AgentContinuityRecallVocabulary,
  anchorPolicy: AgentContinuityRecallAnchorPolicy,
): AgentContinuityRecallQueryMatch[] {
  return concepts
    .map((concept) => {
      const match = scoreLabels(
        query,
        terms,
        [concept.label, ...concept.aliases],
        options.similarity,
        vocabulary,
        anchorPolicy,
      );
      return { ...match, uri: concept.uri, label: concept.label, kind: concept.entityKind, anchorEligible: false };
    })
    .filter((match) => match.score >= options.minimumScore)
    .sort(compareMatches)
    .slice(0, options.maxConceptMatches);
}

function rankEntityMatches(
  options: AgentContinuityRecallQueryPlanOptions,
  entities: readonly AgentContinuityGraphEntity[],
  query: string,
  terms: readonly string[],
  vocabulary: AgentContinuityRecallVocabulary,
  anchorPolicy: AgentContinuityRecallAnchorPolicy,
): AgentContinuityRecallQueryMatch[] {
  return entities
    .filter((entity) => entity.status === "active")
    .map((entity) => {
      const match = scoreLabels(
        query,
        terms,
        [entity.label, ...entity.aliases],
        options.similarity,
        vocabulary,
        anchorPolicy,
      );
      return { ...match, uri: entity.uri, label: entity.label, kind: entity.kind, anchorEligible: match.direct };
    })
    .filter((match) => match.score >= options.minimumScore)
    .sort(compareMatches)
    .slice(0, options.maxEntityMatches);
}

function rankRelationMatches(
  options: AgentContinuityRecallQueryPlanOptions,
  query: string,
  terms: readonly string[],
  vocabulary: AgentContinuityRecallVocabulary,
  anchorPolicy: AgentContinuityRecallAnchorPolicy,
): AgentContinuityRecallRelationMatch[] {
  return AgentContinuityRelationCatalog.map((definition) => {
    const match = scoreLabels(
      query,
      terms,
      [definition.id, definition.label, ...definition.aliases],
      options.similarity,
      vocabulary,
      anchorPolicy,
    );
    return {
      relationId: definition.id,
      label: definition.label,
      score: match.score,
      direct: match.direct,
    };
  })
    .filter((match) => match.direct || match.score >= options.directScore)
    .sort(
      (left, right) =>
        Number(right.direct) - Number(left.direct) ||
        right.score - left.score ||
        left.relationId.localeCompare(right.relationId),
    )
    .slice(0, options.maxRelationMatches);
}

function buildExpandedQuery(input: {
  readonly original: string;
  readonly concepts: readonly AgentContinuityRecallQueryMatch[];
  readonly entities: readonly AgentContinuityRecallQueryMatch[];
  readonly relations: readonly AgentContinuityRecallRelationMatch[];
  readonly graph: AgentContinuityGraphSnapshot;
  readonly anchorUris: ReadonlySet<string>;
  readonly now: Date;
  readonly maxRelationMatches: number;
  readonly directScore: number;
  readonly maxGraphHops: number;
}): string {
  const additions: string[] = [];
  const add = (value: string | undefined): void => {
    const normalized = value?.trim();
    if (normalized) additions.push(normalized);
  };

  for (const match of input.concepts) {
    if (!match.direct) continue;
    add(match.label);
  }
  for (const match of input.entities) {
    if (!isDirectAnchor(match, input.directScore)) continue;
    add(match.label);
  }
  const entities = new Map(input.graph.entities.map((entity) => [entity.uri, entity] as const));
  const preferredRelationIds = new Set(
    input.relations
      .filter((match) => match.direct && match.score >= input.directScore)
      .map((match) => match.relationId),
  );
  const anchorScores = new Map(
    input.entities
      .filter((match): match is AgentContinuityRecallQueryMatch & { readonly uri: string } => Boolean(match.uri))
      .filter((match) => input.anchorUris.has(match.uri))
      .map((match) => [match.uri, match.score] as const),
  );
  const neighborPaths = [
    ...traverseAgentContinuityGraph({
      relations: input.graph.relations,
      entities: input.graph.entities,
      anchorUris: [...input.anchorUris],
      anchorScores,
      now: input.now,
      maxHops: input.maxGraphHops,
    }),
  ]
    .sort((left, right) => compareGraphPaths(left, right, preferredRelationIds))
    .slice(0, input.maxRelationMatches);
  for (const path of neighborPaths) {
    add(path.relation.relationLabel);
    add(entities.get(path.toUri)?.label);
  }

  return uniqueStrings([input.original, ...additions]).join("\n");
}

function isDirectAnchor(match: AgentContinuityRecallQueryMatch, directScore: number): boolean {
  // Exact phrase/token evidence is already lexical proof. The aggregate score
  // is intentionally allowed to be below the fuzzy similarity threshold when
  // a long label contains a smaller, fully covered entity phrase.
  return match.anchorEligible && (match.direct || match.score >= directScore);
}

function scoreLabels(
  query: string,
  queryTerms: readonly string[],
  labels: readonly string[],
  similarity: Pick<AgentContinuityTextSimilarity, "compare" | "terms" | "contentTerms">,
  vocabulary: AgentContinuityRecallVocabulary,
  anchorPolicy: AgentContinuityRecallAnchorPolicy,
): {
  readonly score: number;
  readonly direct: boolean;
  readonly matchedBy: readonly ("phrase" | "token" | "fuzzy")[];
  readonly matchedTerms: readonly string[];
  readonly matchedLabel?: string;
} {
  const evidence = scoreAgentContinuityRecallLabels({
    query,
    queryTerms,
    labels,
    similarity,
    vocabulary,
    policy: anchorPolicy,
  });
  return {
    score: evidence.score,
    direct: evidence.direct,
    matchedBy: evidence.matchedBy,
    matchedTerms: evidence.matchedTerms,
    ...(evidence.matchedLabel ? { matchedLabel: evidence.matchedLabel } : {}),
  };
}

function buildVocabulary(options: AgentContinuityRecallQueryPlanOptions): AgentContinuityRecallVocabulary {
  const documents = [
    ...options.concepts.map((concept) => [concept.label, ...concept.aliases]),
    ...options.graph.entities.map((entity) => [entity.label, ...entity.aliases]),
  ];
  return buildAgentContinuityRecallVocabulary(
    documents.map((document) => document.flatMap((label) => options.similarity.contentTerms(label))),
  );
}

function compareMatches(left: AgentContinuityRecallQueryMatch, right: AgentContinuityRecallQueryMatch): number {
  return (
    Number(right.direct) - Number(left.direct) ||
    right.score - left.score ||
    left.label.localeCompare(right.label) ||
    (left.uri ?? "").localeCompare(right.uri ?? "")
  );
}

function compareGraphPaths(
  left: AgentContinuityGraphTraversalPath,
  right: AgentContinuityGraphTraversalPath,
  preferredRelationIds: ReadonlySet<string>,
): number {
  return (
    Number(preferredRelationIds.has(right.relation.relationId)) -
      Number(preferredRelationIds.has(left.relation.relationId)) ||
    right.score - left.score ||
    left.distance - right.distance ||
    right.relation.supportMass - left.relation.supportMass ||
    right.relation.confidence - left.relation.confidence ||
    left.relation.uri.localeCompare(right.relation.uri)
  );
}

function emptyPlan(original: string, terms: readonly string[]): AgentContinuityRecallQueryPlan {
  return {
    original,
    expandedQuery: original,
    terms,
    conceptMatches: [],
    entityMatches: [],
    relationMatches: [],
    anchorUris: [],
  };
}

function validateOptions(options: AgentContinuityRecallQueryPlanOptions): void {
  if (!(options.now instanceof Date) || Number.isNaN(options.now.getTime())) {
    throw new Error("Continuity recall query planning requires a valid current time.");
  }
  if (!Number.isFinite(options.minimumScore) || options.minimumScore < 0 || options.minimumScore > 1) {
    throw new Error("Continuity recall query minimum score must be between 0 and 1.");
  }
  if (!Number.isFinite(options.directScore) || options.directScore < 0 || options.directScore > 1) {
    throw new Error("Continuity recall query direct score must be between 0 and 1.");
  }
  for (const [name, value] of [
    ["maxConceptMatches", options.maxConceptMatches],
    ["maxEntityMatches", options.maxEntityMatches],
    ["maxRelationMatches", options.maxRelationMatches],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`Continuity recall query ${name} must be non-negative.`);
  }
}

function normalize(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}
