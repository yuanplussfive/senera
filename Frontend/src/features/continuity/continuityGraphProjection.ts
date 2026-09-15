import dagre from "@dagrejs/dagre";
import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type { ContinuitySnapshotData } from "../../api/eventTypes";

type ContinuityGraph = NonNullable<ContinuitySnapshotData["graph"]>;
type ContinuityGraphEntity = ContinuityGraph["entities"][number];
type ContinuityGraphRelation = ContinuityGraph["relations"][number];

export interface ContinuityGraphPromptRelationRef {
  readonly subject: string;
  readonly relationId: string;
  readonly object: string;
}

export interface ContinuityGraphNodeData extends Record<string, unknown> {
  readonly label: string;
  readonly kind: string;
  readonly degree: number;
  readonly anchored: boolean;
  readonly selected: boolean;
}

export interface ContinuityGraphEdgeData extends Record<string, unknown> {
  readonly relationId: string;
  readonly relationLabel: string;
  readonly maturity: ContinuityGraphRelation["maturity"];
  readonly selectedForPrompt: boolean;
}

export type ContinuityGraphFlowNode = Node<ContinuityGraphNodeData, "continuityEntity">;
export type ContinuityGraphFlowEdge = Edge<ContinuityGraphEdgeData>;

export interface ContinuityGraphViewPolicy {
  readonly maxRelations: number;
  readonly maxEntities: number;
  readonly nodeWidth: number;
  readonly nodeHeight: number;
  readonly nodeSeparation: number;
  readonly rankSeparation: number;
}

export const DefaultContinuityGraphViewPolicy: ContinuityGraphViewPolicy = Object.freeze({
  maxRelations: 24,
  maxEntities: 28,
  nodeWidth: 164,
  nodeHeight: 58,
  nodeSeparation: 26,
  rankSeparation: 72,
});

export interface ContinuityGraphProjectionInput {
  readonly graph: ContinuityGraph;
  readonly promptRelations?: readonly ContinuityGraphPromptRelationRef[];
  readonly anchorLabels?: readonly string[];
  readonly selectedEntityUri?: string;
  readonly relationMode?: "all" | "focus";
  readonly policy?: ContinuityGraphViewPolicy;
}

export interface ContinuityGraphProjection {
  readonly nodes: readonly ContinuityGraphFlowNode[];
  readonly edges: readonly ContinuityGraphFlowEdge[];
  readonly entityCount: number;
  readonly relationCount: number;
}

interface RankedRelation {
  readonly relation: ContinuityGraphRelation;
  readonly subject: ContinuityGraphEntity;
  readonly object: ContinuityGraphEntity;
  readonly selectedForPrompt: boolean;
  readonly anchored: boolean;
}

/**
 * Creates a bounded, deterministic visual projection from the authoritative
 * graph snapshot. It never invents nodes or infers relationships in the UI.
 */
export function projectContinuityGraph(input: ContinuityGraphProjectionInput): ContinuityGraphProjection {
  const policy = input.policy ?? DefaultContinuityGraphViewPolicy;
  validatePolicy(policy);

  const entities = new Map(input.graph.entities.map((entity) => [entity.uri, entity] as const));
  const promptSignatures = new Set((input.promptRelations ?? []).map(promptRelationSignature));
  const anchors = new Set((input.anchorLabels ?? []).map(normalize).filter(Boolean));
  const candidates = input.graph.relations
    .filter((relation) => relation.status === "active")
    .flatMap((relation) => {
      const subject = entities.get(relation.subjectUri);
      const object = entities.get(relation.objectUri);
      if (!subject || !object) return [];
      return [
        {
          relation,
          subject,
          object,
          selectedForPrompt: promptSignatures.has(relationSignature(subject, relation, object)),
          anchored: entityMatchesAnchors(subject, anchors) || entityMatchesAnchors(object, anchors),
        },
      ];
    });
  const ranked = candidates
    .filter((entry) => input.relationMode !== "focus" || entry.selectedForPrompt || entry.anchored)
    .sort(compareRankedRelations);
  const selected = selectBoundedRelations(ranked, policy);
  const degrees = countDegrees(selected);
  const selectedEntities = uniqueEntities(selected);
  const positions = layoutEntities(selectedEntities, selected, policy);

  return {
    nodes: selectedEntities.map((entity) => ({
      id: entity.uri,
      type: "continuityEntity",
      position: requirePosition(positions, entity.uri),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: entity.label,
        kind: entity.kind,
        degree: degrees.get(entity.uri) ?? 0,
        anchored: entityMatchesAnchors(entity, anchors),
        selected: entity.uri === input.selectedEntityUri,
      },
      draggable: false,
      selectable: false,
      focusable: false,
    })),
    edges: selected.map((entry) => projectEdge(entry)),
    entityCount: selectedEntities.length,
    relationCount: selected.length,
  };
}

function selectBoundedRelations(
  ranked: readonly RankedRelation[],
  policy: ContinuityGraphViewPolicy,
): readonly RankedRelation[] {
  const entityUris = new Set<string>();
  const selected: RankedRelation[] = [];
  for (const entry of ranked) {
    if (selected.length >= policy.maxRelations) break;
    const nextEntityCount =
      entityUris.size + Number(!entityUris.has(entry.subject.uri)) + Number(!entityUris.has(entry.object.uri));
    if (nextEntityCount > policy.maxEntities) continue;
    entityUris.add(entry.subject.uri);
    entityUris.add(entry.object.uri);
    selected.push(entry);
  }
  return selected;
}

function uniqueEntities(relations: readonly RankedRelation[]): readonly ContinuityGraphEntity[] {
  const entities = new Map<string, ContinuityGraphEntity>();
  for (const { subject, object } of relations) {
    entities.set(subject.uri, subject);
    entities.set(object.uri, object);
  }
  return [...entities.values()].sort(
    (left, right) => left.label.localeCompare(right.label) || left.uri.localeCompare(right.uri),
  );
}

function countDegrees(relations: readonly RankedRelation[]): ReadonlyMap<string, number> {
  const degrees = new Map<string, number>();
  for (const { subject, object } of relations) {
    degrees.set(subject.uri, (degrees.get(subject.uri) ?? 0) + 1);
    degrees.set(object.uri, (degrees.get(object.uri) ?? 0) + 1);
  }
  return degrees;
}

function layoutEntities(
  entities: readonly ContinuityGraphEntity[],
  relations: readonly RankedRelation[],
  policy: ContinuityGraphViewPolicy,
): ReadonlyMap<string, { readonly x: number; readonly y: number }> {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: "LR",
    nodesep: policy.nodeSeparation,
    ranksep: policy.rankSeparation,
    marginx: policy.nodeSeparation,
    marginy: policy.nodeSeparation,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const entity of entities) graph.setNode(entity.uri, { width: policy.nodeWidth, height: policy.nodeHeight });
  for (const { relation } of relations) {
    graph.setEdge(relation.subjectUri, relation.objectUri, {}, relation.uri);
  }
  dagre.layout(graph);

  return new Map(
    entities.map((entity) => {
      const position = graph.node(entity.uri);
      return [
        entity.uri,
        {
          x: position.x - policy.nodeWidth / 2,
          y: position.y - policy.nodeHeight / 2,
        },
      ] as const;
    }),
  );
}

function requirePosition(
  positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
  entityUri: string,
): { readonly x: number; readonly y: number } {
  const position = positions.get(entityUri);
  if (!position) throw new Error(`Continuity graph layout is missing entity position: ${entityUri}`);
  return position;
}

function projectEdge(entry: RankedRelation): ContinuityGraphFlowEdge {
  const color = entry.selectedForPrompt ? "var(--accent-content)" : "var(--line-strong)";
  return {
    id: entry.relation.uri,
    source: entry.relation.subjectUri,
    target: entry.relation.objectUri,
    type: "smoothstep",
    label: entry.relation.relationLabel,
    data: {
      relationId: entry.relation.relationId,
      relationLabel: entry.relation.relationLabel,
      maturity: entry.relation.maturity,
      selectedForPrompt: entry.selectedForPrompt,
    },
    style: {
      stroke: color,
      strokeWidth: entry.selectedForPrompt ? 1.8 : 1.2,
      ...(entry.relation.maturity === "candidate" ? { strokeDasharray: "4 3" } : {}),
    },
    labelStyle: {
      fill: "var(--content-secondary)",
      fontSize: 10,
      fontWeight: entry.selectedForPrompt ? 600 : 500,
    },
    labelBgStyle: { fill: "var(--surface-raised)", fillOpacity: 0.94 },
    labelBgPadding: [3, 2],
    labelBgBorderRadius: 3,
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
  };
}

function compareRankedRelations(left: RankedRelation, right: RankedRelation): number {
  return (
    Number(right.selectedForPrompt) - Number(left.selectedForPrompt) ||
    Number(right.anchored) - Number(left.anchored) ||
    maturityRank(right.relation.maturity) - maturityRank(left.relation.maturity) ||
    right.relation.supportMass - left.relation.supportMass ||
    right.relation.confidence - left.relation.confidence ||
    right.relation.updatedAt.localeCompare(left.relation.updatedAt) ||
    left.relation.uri.localeCompare(right.relation.uri)
  );
}

function maturityRank(maturity: ContinuityGraphRelation["maturity"]): number {
  return maturity === "established" ? 2 : maturity === "active" ? 1 : 0;
}

function relationSignature(
  subject: Pick<ContinuityGraphEntity, "label">,
  relation: Pick<ContinuityGraphRelation, "relationId">,
  object: Pick<ContinuityGraphEntity, "label">,
): string {
  return [normalize(subject.label), relation.relationId, normalize(object.label)].join("\u0000");
}

function promptRelationSignature(relation: ContinuityGraphPromptRelationRef): string {
  return [normalize(relation.subject), relation.relationId, normalize(relation.object)].join("\u0000");
}

function entityMatchesAnchors(entity: ContinuityGraphEntity, anchors: ReadonlySet<string>): boolean {
  if (anchors.size === 0) return false;
  return [entity.label, ...entity.aliases]
    .map(normalize)
    .some((label) => [...anchors].some((anchor) => label.includes(anchor) || anchor.includes(label)));
}

function validatePolicy(policy: ContinuityGraphViewPolicy): void {
  for (const [name, value] of [
    ["maxRelations", policy.maxRelations],
    ["maxEntities", policy.maxEntities],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Continuity graph view policy ${name} must be a positive safe integer.`);
    }
  }
  for (const [name, value] of [
    ["nodeWidth", policy.nodeWidth],
    ["nodeHeight", policy.nodeHeight],
    ["nodeSeparation", policy.nodeSeparation],
    ["rankSeparation", policy.rankSeparation],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Continuity graph view policy ${name} must be positive.`);
    }
  }
}

function normalize(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}
