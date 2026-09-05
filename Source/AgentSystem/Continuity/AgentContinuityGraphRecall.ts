import type {
  AgentContinuityGraphEntity,
  AgentContinuityGraphPromptRelation,
  AgentContinuityGraphRelation,
} from "./AgentContinuityGraphTypes.js";
import { isAgentContinuityTemporalActive } from "./AgentContinuityDomain.js";
import { getAgentContinuityRelationDefinition } from "./AgentContinuityRelationCatalog.js";
import {
  traverseAgentContinuityGraph,
  type AgentContinuityGraphTraversalPath,
} from "./AgentContinuityGraphTraversal.js";
import type { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";

export interface AgentContinuityGraphRecallOptions {
  readonly query: string;
  readonly relations: readonly AgentContinuityGraphRelation[];
  readonly entities: readonly AgentContinuityGraphEntity[];
  /** Canonical entity anchors resolved by the local query planner. */
  readonly anchorUris?: readonly string[];
  /** Exact catalog ids directly named by the local query planner. */
  readonly preferredRelationIds?: readonly string[];
  readonly similarity: Pick<AgentContinuityTextSimilarity, "compare">;
  readonly now: Date;
  readonly minimumScore: number;
  readonly maxEntries: number;
  readonly maxHops: number;
}

export interface AgentContinuityGraphRecallResult {
  readonly relations: readonly AgentContinuityGraphPromptRelation[];
  readonly matchedRelationUris: readonly string[];
}

/**
 * Resolves graph context locally. Relation intent and entity anchors are
 * direct evidence; graph neighbors are scored by their bounded path distance.
 * Traversal broadens recall without becoming an assertion or rule trigger.
 */
export function recallAgentContinuityGraph(
  options: AgentContinuityGraphRecallOptions,
): AgentContinuityGraphRecallResult {
  const query = options.query.trim();
  validateOptions(options);
  if (!query || options.maxEntries === 0) {
    return { relations: [], matchedRelationUris: [] };
  }

  const entities = new Map(
    options.entities.filter((entity) => entity.status === "active").map((entity) => [entity.uri, entity] as const),
  );
  const entityScores = new Map(
    [...entities.values()].map((entity) => [entity.uri, compareEntity(query, entity, options.similarity)] as const),
  );
  const anchorUris = new Set(
    options.anchorUris !== undefined
      ? options.anchorUris.filter((uri) => entities.has(uri))
      : [...entityScores.entries()].filter(([, score]) => score >= options.minimumScore).map(([uri]) => uri),
  );
  const preferredRelationIds = new Set(options.preferredRelationIds ?? []);
  const eligibleRelations = options.relations.filter(
    (relation) =>
      relation.status === "active" &&
      relation.maturity !== "candidate" &&
      isAgentContinuityTemporalActive(relation.temporal, options.now),
  );
  const anchorScores = new Map([...anchorUris].map((uri) => [uri, requiredScore(entityScores, uri)] as const));
  const paths = traverseAgentContinuityGraph({
    relations: eligibleRelations,
    entities: [...entities.values()],
    anchorUris: [...anchorUris],
    anchorScores,
    now: options.now,
    maxHops: options.maxHops,
  });
  const pathsByRelationUri = new Map(paths.map((path) => [path.relation.uri, path] as const));
  const scored = eligibleRelations.flatMap((relation) =>
    scoreRelation(query, relation, entities, preferredRelationIds, pathsByRelationUri, options),
  );
  const matched = [
    ...new Map(
      scored
        .filter((entry) => entry.score >= options.minimumScore)
        .map((entry) => [entry.relation.uri, entry] as const),
    ).values(),
  ].sort(compareScoredRelations);
  const selected = matched.slice(0, options.maxEntries);

  return {
    relations: selected.map((entry) => projectPromptRelation(entry.relation, entities)),
    matchedRelationUris: selected.map((entry) => entry.relation.uri),
  };
}

function validateOptions(options: AgentContinuityGraphRecallOptions): void {
  if (!(options.now instanceof Date) || Number.isNaN(options.now.getTime())) {
    throw new Error("Continuity graph recall requires a valid current time.");
  }
  if (!Number.isFinite(options.minimumScore) || options.minimumScore < 0 || options.minimumScore > 1) {
    throw new Error("Continuity graph recall minimum score must be between 0 and 1.");
  }
  if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 0) {
    throw new Error("Continuity graph recall max entries must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(options.maxHops) || options.maxHops < 0) {
    throw new Error("Continuity graph recall max hops must be a non-negative safe integer.");
  }
  for (const relationId of options.preferredRelationIds ?? []) {
    getAgentContinuityRelationDefinition(relationId);
  }
}

function compareScoredRelations(left: ScoredRelation, right: ScoredRelation): number {
  return (
    Number(right.preferred) - Number(left.preferred) ||
    Number(right.direct) - Number(left.direct) ||
    right.score - left.score ||
    left.distance - right.distance ||
    right.relation.supportMass - left.relation.supportMass ||
    right.relation.confidence - left.relation.confidence ||
    right.relation.updatedAt.localeCompare(left.relation.updatedAt) ||
    left.relation.uri.localeCompare(right.relation.uri)
  );
}

interface ScoredRelation {
  readonly relation: AgentContinuityGraphRelation;
  readonly score: number;
  readonly preferred: boolean;
  readonly direct: boolean;
  readonly distance: number;
}

function scoreRelation(
  query: string,
  relation: AgentContinuityGraphRelation,
  entities: ReadonlyMap<string, AgentContinuityGraphEntity>,
  preferredRelationIds: ReadonlySet<string>,
  pathsByRelationUri: ReadonlyMap<string, AgentContinuityGraphTraversalPath>,
  options: AgentContinuityGraphRecallOptions,
): ScoredRelation[] {
  const subject = entities.get(relation.subjectUri);
  const object = entities.get(relation.objectUri);
  if (!subject) throw new Error(`Continuity graph relation subject entity is missing: ${relation.subjectUri}`);
  if (!object) throw new Error(`Continuity graph relation object entity is missing: ${relation.objectUri}`);
  const definition = getAgentContinuityRelationDefinition(relation.relationId);
  const relationScore = compareTerms(query, [definition.label, ...definition.aliases], options);
  const path = pathsByRelationUri.get(relation.uri);
  const relationIntentScore =
    relationScore * (preferredRelationIds.has(definition.id) ? 1 : definition.recall.pathWeight);
  const score = Math.max(path?.score ?? 0, relationIntentScore);
  if (score <= 0) return [];
  return [
    {
      relation,
      score,
      preferred: preferredRelationIds.has(definition.id),
      direct: relationIntentScore >= options.minimumScore,
      distance: path?.distance ?? Number.POSITIVE_INFINITY,
    },
  ];
}

function compareEntity(
  query: string,
  entity: AgentContinuityGraphEntity,
  similarity: Pick<AgentContinuityTextSimilarity, "compare">,
): number {
  return compareTerms(query, [entity.label, ...entity.aliases], { similarity });
}

function compareTerms(
  query: string,
  terms: readonly string[],
  options: Pick<AgentContinuityGraphRecallOptions, "similarity">,
): number {
  return Math.max(...terms.map((term) => options.similarity.compare(query, term).score));
}

function requiredScore(scores: ReadonlyMap<string, number>, uri: string): number {
  const score = scores.get(uri);
  if (score === undefined) throw new Error(`Continuity graph entity score is missing: ${uri}`);
  return score;
}

function projectPromptRelation(
  relation: AgentContinuityGraphRelation,
  entities: ReadonlyMap<string, AgentContinuityGraphEntity>,
): AgentContinuityGraphPromptRelation {
  const subject = entities.get(relation.subjectUri);
  const object = entities.get(relation.objectUri);
  if (!subject) throw new Error(`Continuity graph prompt subject entity is missing: ${relation.subjectUri}`);
  if (!object) throw new Error(`Continuity graph prompt object entity is missing: ${relation.objectUri}`);
  if (relation.maturity === "candidate") {
    throw new Error(`Candidate continuity relation cannot enter the model prompt: ${relation.uri}`);
  }
  return {
    subject: subject.label,
    subjectKind: subject.kind,
    relationId: relation.relationId,
    relation: relation.relationLabel,
    object: object.label,
    objectKind: object.kind,
    temporal: { ...relation.temporal },
    confidence: relation.confidence,
    maturity: relation.maturity,
  };
}
