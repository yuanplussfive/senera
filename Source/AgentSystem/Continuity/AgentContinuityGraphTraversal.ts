import { isAgentContinuityTemporalActive } from "./AgentContinuityDomain.js";
import type { AgentContinuityGraphEntity, AgentContinuityGraphRelation } from "./AgentContinuityGraphTypes.js";
import { getAgentContinuityRelationDefinition } from "./AgentContinuityRelationCatalog.js";

export interface AgentContinuityGraphTraversalOptions {
  readonly relations: readonly AgentContinuityGraphRelation[];
  readonly entities: readonly AgentContinuityGraphEntity[];
  readonly anchorUris: readonly string[];
  readonly anchorScores?: ReadonlyMap<string, number>;
  readonly now: Date;
  readonly maxHops: number;
}

/** One reachable relation and the strongest bounded path used to reach it. */
export interface AgentContinuityGraphTraversalPath {
  readonly relation: AgentContinuityGraphRelation;
  readonly anchorUri: string;
  readonly fromUri: string;
  readonly toUri: string;
  readonly distance: number;
  readonly score: number;
}

/**
 * Traverses only active, temporal-valid, non-candidate relations. A state is
 * retained per entity and depth so a shorter weaker path cannot hide a longer
 * stronger path, while the caller still has a strict hop bound.
 */
export function traverseAgentContinuityGraph(
  options: AgentContinuityGraphTraversalOptions,
): readonly AgentContinuityGraphTraversalPath[] {
  validateOptions(options);
  if (options.maxHops === 0 || options.anchorUris.length === 0) return [];

  const entities = new Map(options.entities.map((entity) => [entity.uri, entity] as const));
  const activeEntities = new Map([...entities].filter(([, entity]) => entity.status === "active"));
  const adjacency = new Map<string, TraversalEdge[]>();
  for (const relation of eligibleRelations(options)) {
    const subject = activeEntities.get(relation.subjectUri);
    const object = activeEntities.get(relation.objectUri);
    if (!subject) throw new Error(`Continuity graph traversal subject entity is missing: ${relation.subjectUri}`);
    if (!object) throw new Error(`Continuity graph traversal object entity is missing: ${relation.objectUri}`);
    const definition = getAgentContinuityRelationDefinition(relation.relationId);
    const weight = definition.recall.pathWeight;
    validatePathWeight(relation.relationId, weight);
    addEdge(adjacency, relation.subjectUri, {
      relation,
      fromUri: relation.subjectUri,
      toUri: relation.objectUri,
      weight,
      maxHops: definition.recall.maxHops,
    });
    addEdge(adjacency, relation.objectUri, {
      relation,
      fromUri: relation.objectUri,
      toUri: relation.subjectUri,
      weight,
      maxHops: definition.recall.maxHops,
    });
  }

  const states = new Map<string, TraversalState>();
  const queue: TraversalState[] = [];
  const paths = new Map<string, AgentContinuityGraphTraversalPath>();
  for (const anchorUri of uniqueAnchors(options.anchorUris, activeEntities)) {
    const state: TraversalState = {
      anchorUri,
      entityUri: anchorUri,
      distance: 0,
      score: anchorScore(anchorUri, options.anchorScores),
    };
    const key = stateKey(state.entityUri, state.distance);
    states.set(key, state);
    queue.push(state);
  }

  for (let index = 0; index < queue.length; index += 1) {
    const state = queue[index];
    if (state.distance >= options.maxHops) continue;
    for (const edge of adjacency.get(state.entityUri) ?? []) {
      const distance = state.distance + 1;
      if (edge.maxHops !== undefined && distance > edge.maxHops) continue;
      const score = state.score * edge.weight;
      const path: AgentContinuityGraphTraversalPath = {
        relation: edge.relation,
        anchorUri: state.anchorUri,
        fromUri: edge.fromUri,
        toUri: edge.toUri,
        distance,
        score,
      };
      const currentPath = paths.get(edge.relation.uri);
      if (!currentPath || comparePaths(path, currentPath) < 0) paths.set(edge.relation.uri, path);

      const nextState: TraversalState = {
        anchorUri: state.anchorUri,
        entityUri: edge.toUri,
        distance,
        score,
      };
      const key = stateKey(nextState.entityUri, nextState.distance);
      const currentState = states.get(key);
      if (!currentState || compareStates(nextState, currentState) < 0) {
        states.set(key, nextState);
        queue.push(nextState);
      }
    }
  }

  return [...paths.values()].sort(comparePaths);
}

function eligibleRelations(options: AgentContinuityGraphTraversalOptions): readonly AgentContinuityGraphRelation[] {
  return options.relations.filter((relation) => {
    if (relation.status !== "active" || relation.maturity === "candidate") return false;
    if (!isAgentContinuityTemporalActive(relation.temporal, options.now)) return false;
    const definition = getAgentContinuityRelationDefinition(relation.relationId);
    return definition.recall.traversable && (definition.recall.maxHops === undefined || definition.recall.maxHops > 0);
  });
}

function uniqueAnchors(
  anchorUris: readonly string[],
  entities: ReadonlyMap<string, AgentContinuityGraphEntity>,
): readonly string[] {
  return [...new Set(anchorUris)].filter((uri) => entities.has(uri));
}

function anchorScore(uri: string, scores: ReadonlyMap<string, number> | undefined): number {
  const score = scores?.get(uri);
  if (score === undefined) return 1;
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`Continuity graph anchor score must be between 0 and 1: ${uri}`);
  }
  return score;
}

function addEdge(adjacency: Map<string, TraversalEdge[]>, uri: string, edge: TraversalEdge): void {
  const edges = adjacency.get(uri) ?? [];
  edges.push(edge);
  edges.sort(compareEdges);
  adjacency.set(uri, edges);
}

function compareEdges(left: TraversalEdge, right: TraversalEdge): number {
  return (
    left.relation.uri.localeCompare(right.relation.uri) ||
    left.toUri.localeCompare(right.toUri) ||
    left.fromUri.localeCompare(right.fromUri)
  );
}

function comparePaths(left: AgentContinuityGraphTraversalPath, right: AgentContinuityGraphTraversalPath): number {
  return (
    right.score - left.score ||
    left.distance - right.distance ||
    left.relation.uri.localeCompare(right.relation.uri) ||
    left.anchorUri.localeCompare(right.anchorUri) ||
    left.toUri.localeCompare(right.toUri)
  );
}

function compareStates(left: TraversalState, right: TraversalState): number {
  return (
    right.score - left.score ||
    left.distance - right.distance ||
    left.anchorUri.localeCompare(right.anchorUri) ||
    left.entityUri.localeCompare(right.entityUri)
  );
}

function stateKey(entityUri: string, distance: number): string {
  return `${entityUri}\u0000${distance}`;
}

function validateOptions(options: AgentContinuityGraphTraversalOptions): void {
  if (!(options.now instanceof Date) || Number.isNaN(options.now.getTime())) {
    throw new Error("Continuity graph traversal requires a valid current time.");
  }
  if (!Number.isSafeInteger(options.maxHops) || options.maxHops < 0) {
    throw new Error("Continuity graph traversal max hops must be a non-negative safe integer.");
  }
}

function validatePathWeight(relationId: string, weight: number): void {
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new Error(`Continuity relation ${relationId} path weight must be between 0 and 1.`);
  }
}

interface TraversalEdge {
  readonly relation: AgentContinuityGraphRelation;
  readonly fromUri: string;
  readonly toUri: string;
  readonly weight: number;
  readonly maxHops?: number;
}

interface TraversalState {
  readonly anchorUri: string;
  readonly entityUri: string;
  readonly distance: number;
  readonly score: number;
}
